import { CircuitBreaker } from './circuit-breaker';
import { ServiceUnavailableException } from '@nestjs/common';

describe('CircuitBreaker', () => {
  it('cho request đi qua khi CLOSED', async () => {
    const cb = new CircuitBreaker('test', 3, 1000);
    await expect(cb.exec(async () => 'ok')).resolves.toBe('ok');
  });

  it('mở mạch sau khi đạt ngưỡng lỗi → fail-fast', async () => {
    const cb = new CircuitBreaker('test', 3, 10_000);
    const boom = () => cb.exec(async () => { throw new Error('down'); });

    await expect(boom()).rejects.toThrow('down');
    await expect(boom()).rejects.toThrow('down');
    await expect(boom()).rejects.toThrow('down'); // lần thứ 3 → mở mạch

    // Lần kế: fail-fast bằng ServiceUnavailable, KHÔNG gọi fn nữa
    const fn = jest.fn(async () => 'ok');
    await expect(cb.exec(fn)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fn).not.toHaveBeenCalled();
  });

  it('sau cooldown → HALF_OPEN, thành công → CLOSED lại', async () => {
    const cb = new CircuitBreaker('test', 1, 50); // 1 lỗi mở mạch, cooldown 50ms
    await expect(cb.exec(async () => { throw new Error('x'); })).rejects.toThrow('x');
    await expect(cb.exec(async () => 'ok')).rejects.toBeInstanceOf(ServiceUnavailableException);

    await new Promise((r) => setTimeout(r, 60)); // chờ hết cooldown
    await expect(cb.exec(async () => 'recovered')).resolves.toBe('recovered');
    // đã CLOSED: request tiếp theo vẫn đi qua
    await expect(cb.exec(async () => 'still-ok')).resolves.toBe('still-ok');
  });
});
