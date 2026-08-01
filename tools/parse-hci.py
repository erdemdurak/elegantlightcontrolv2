#!/usr/bin/env python3
"""
Parse an Apple PacketLogger .pklg HCI capture (from an iOS sysdiagnose with the
Bluetooth logging profile installed) and print the ATT traffic.

We only care about ATT: writes are how a phone drives a BLE light controller, and
notifications are how the controller answers. Everything else in HCI is noise here.

Usage:
    parse-hci.py <file.pklg> [--all] [--min-len N] [--handle 0xNN]

Record layout (little-endian payload; header byte order varies — see below):
    uint32 length      # bytes that follow (8 ts + 1 type + payload)
    uint32 secs
    uint32 usecs
    uint8  type        # 0x02 = ACL host->controller (SENT), 0x03 = ACL controller->host (RECV)
    bytes  payload

The header's byte order depends on where the file came from. A .pklg pulled out of an iOS
sysdiagnose is big-endian; one saved by PacketLogger.app on an Intel Mac is little-endian.
Guessing wrong yields a silent "0 records" rather than an error, so the order is detected
from the file itself.
"""

import struct
import sys
from datetime import datetime, timezone

ACL_SENT = 0x02
ACL_RECV = 0x03

ATT_CID = 0x0004

ATT_OPCODES = {
    0x01: "ERROR_RSP",
    0x02: "MTU_REQ",
    0x03: "MTU_RSP",
    0x04: "FIND_INFO_REQ",
    0x05: "FIND_INFO_RSP",
    0x08: "READ_BY_TYPE_REQ",
    0x09: "READ_BY_TYPE_RSP",
    0x0A: "READ_REQ",
    0x0B: "READ_RSP",
    0x10: "READ_BY_GROUP_REQ",
    0x11: "READ_BY_GROUP_RSP",
    0x12: "WRITE_REQ",
    0x13: "WRITE_RSP",
    0x1B: "NOTIFY",
    0x1D: "INDICATE",
    0x1E: "CONFIRM",
    0x52: "WRITE_CMD",
}

HCI_EVENT = 0x01
LE_META = 0x3E

# The opcodes that actually carry a payload we want to see.
PAYLOAD_OPS = {0x12, 0x52, 0x1B, 0x1D, 0x0B}


def walk(blob, endian):
    """Yield (timestamp, type, payload) reading the record headers in one byte order."""
    off = 0
    n = len(blob)
    while off + 4 <= n:
        (length,) = struct.unpack_from(endian + "I", blob, off)
        # Guard against a truncated tail or a desync; both happen in real captures.
        if length < 9 or off + 4 + length > n:
            break
        secs, usecs = struct.unpack_from(endian + "II", blob, off + 4)
        rtype = blob[off + 12]
        payload = blob[off + 13 : off + 4 + length]
        yield (secs + usecs / 1e6, rtype, payload)
        off += 4 + length


def detect_endian(blob):
    """
    Pick the header byte order by seeing which one walks further into the file.

    A wrong guess does not fail loudly — it reads one absurd length and stops — so counting
    records is the reliable discriminator.
    """
    scores = {}
    for endian in (">", "<"):
        count = 0
        for _ in walk(blob, endian):
            count += 1
            if count >= 64:  # far enough past any plausible coincidence
                break
        scores[endian] = count
    return ">" if scores[">"] >= scores["<"] else "<"


def records(blob):
    """Yield (timestamp, type, payload) for every record in the file."""
    return walk(blob, detect_endian(blob))


def att_from_acl(payload):
    """Pull the ATT PDU out of an ACL packet, or None if it isn't ATT."""
    if len(payload) < 8:
        return None
    handle_flags, acl_len = struct.unpack_from("<HH", payload, 0)
    # Only continuation-free start fragments carry an L2CAP header.
    pb = (handle_flags >> 12) & 0x3
    if pb == 0x1:  # continuing fragment — no L2CAP header
        return None
    conn = handle_flags & 0x0FFF
    l2_len, cid = struct.unpack_from("<HH", payload, 4)
    if cid != ATT_CID:
        return None
    return conn, payload[8 : 8 + l2_len]


def connection_peers(blob):
    """
    Map ACL connection handle -> peer BD_ADDR string, from LE Connection Complete events.

    Without this every row is just "conn 0x040" and there is no way to tell the light
    controller from a watch or a pair of headphones.
    """
    peers = {}
    for _ts, rtype, payload in records(blob):
        if rtype != HCI_EVENT or len(payload) < 2:
            continue
        if payload[0] != LE_META:
            continue
        sub = payload[2] if len(payload) > 2 else None
        # 0x01 LE Connection Complete, 0x0A LE Enhanced Connection Complete.
        # Both carry: status, handle(2), role, peer_addr_type, peer_addr(6) ...
        if sub == 0x01 and len(payload) >= 13:
            status = payload[3]
            handle = payload[4] | (payload[5] << 8)
            addr = payload[8:14]
        elif sub == 0x0A and len(payload) >= 13:
            status = payload[3]
            handle = payload[4] | (payload[5] << 8)
            addr = payload[8:14]
        else:
            continue
        if status != 0:
            continue
        peers[handle] = ":".join(f"{b:02X}" for b in reversed(addr))
    return peers


def main():
    args = [a for a in sys.argv[1:]]
    if not args:
        print(__doc__)
        return 1
    path = args[0]
    show_all = "--all" in args
    min_len = 0
    want_handle = None
    if "--min-len" in args:
        min_len = int(args[args.index("--min-len") + 1])
    if "--handle" in args:
        want_handle = int(args[args.index("--handle") + 1], 0)

    with open(path, "rb") as fh:
        blob = fh.read()

    peers = connection_peers(blob)

    total = 0
    att_count = 0
    seen_ops = {}
    rows = []

    for ts, rtype, payload in records(blob):
        total += 1
        if rtype not in (ACL_SENT, ACL_RECV):
            continue
        parsed = att_from_acl(payload)
        if not parsed:
            continue
        conn, pdu = parsed
        if not pdu:
            continue
        att_count += 1
        op = pdu[0]
        seen_ops[op] = seen_ops.get(op, 0) + 1
        if not show_all and op not in PAYLOAD_OPS:
            continue
        handle = None
        value = b""
        if op in (0x12, 0x52, 0x1B, 0x1D) and len(pdu) >= 3:
            (handle,) = struct.unpack_from("<H", pdu, 1)
            value = pdu[3:]
        elif op == 0x0B:
            value = pdu[1:]
        if want_handle is not None and handle != want_handle:
            continue
        if len(value) < min_len:
            continue
        rows.append((ts, rtype, conn, op, handle, value))

    print(f"file: {path}")
    print(f"records: {total}   ATT PDUs: {att_count}")
    if peers:
        print("connections:")
        for h in sorted(peers):
            print(f"   0x{h:03x}  {peers[h]}")
    print("ATT opcodes seen:")
    for op in sorted(seen_ops):
        print(f"   0x{op:02x} {ATT_OPCODES.get(op,'?'):<18} x{seen_ops[op]}")
    print()
    if not rows:
        print("No ATT payload PDUs matched the filter.")
        return 0
    print(f"{'time':<13} {'dir':<4} {'conn':<5} {'op':<11} {'handle':<7} value")
    for ts, rtype, conn, op, handle, value in rows:
        t = datetime.fromtimestamp(ts, timezone.utc).strftime("%H:%M:%S.%f")[:-3]
        d = "TX" if rtype == ACL_SENT else "RX"
        h = f"0x{handle:04x}" if handle is not None else "-"
        print(f"{t:<13} {d:<4} 0x{conn:03x} {ATT_OPCODES.get(op,'?'):<11} {h:<7} {value.hex()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
