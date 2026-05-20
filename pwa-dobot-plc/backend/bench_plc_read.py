"""One-shot benchmark: how fast can snap7 read DB123/124/125 in isolation?
Bypasses Flask, threads, and the write queue. Just raw reads.
"""
import time
import snap7

PLC_IP = '192.168.7.2'
RACK = 0
SLOT = 1

def main():
    c = snap7.client.Client()
    print(f'Connecting to {PLC_IP}...')
    t0 = time.perf_counter()
    c.connect(PLC_IP, RACK, SLOT)
    print(f'  connect:        {(time.perf_counter()-t0)*1000:7.1f}ms')

    print(f'\nReading DB123 (75 bytes) x10:')
    for i in range(10):
        t = time.perf_counter()
        _ = c.db_read(123, 0, 75)
        print(f'  iter {i+1}:        {(time.perf_counter()-t)*1000:7.1f}ms')

    print(f'\nReading DB124 (2 bytes) x10:')
    for i in range(10):
        t = time.perf_counter()
        _ = c.db_read(124, 0, 2)
        print(f'  iter {i+1}:        {(time.perf_counter()-t)*1000:7.1f}ms')

    print(f'\nReading DB125 (32 bytes) x10:')
    for i in range(10):
        t = time.perf_counter()
        _ = c.db_read(125, 0, 32)
        print(f'  iter {i+1}:        {(time.perf_counter()-t)*1000:7.1f}ms')

    print(f'\n3 sequential reads (full cycle) x10:')
    for i in range(10):
        t = time.perf_counter()
        _ = c.db_read(123, 0, 75)
        _ = c.db_read(124, 0, 2)
        _ = c.db_read(125, 0, 32)
        print(f'  iter {i+1}:        {(time.perf_counter()-t)*1000:7.1f}ms')

    c.disconnect()
    c.destroy()


if __name__ == '__main__':
    main()
