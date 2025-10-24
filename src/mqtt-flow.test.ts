import { NEVER_ABORTED } from '@xstd/abortable';
import { type PushToPullOptions, ReadableFlow } from '@xstd/flow';
import { describe, expect, it } from 'vitest';
import { MqttDownPacket, MqttFlow } from './mqtt-flow.js';

describe('MqttFlow', () => {
  it('should work', { timeout: 10000 }, async () => {
    // TODO implement tests
    const client = new MqttFlow('mqtt://broker.hivemq.com');

    const topic = `topic-${crypto.randomUUID()}`;
    // const topic = `topic-abcdefg`;
    const subscription: ReadableFlow<MqttDownPacket, [options?: PushToPullOptions]> =
      client.subscription(topic);

    const packetPromise: Promise<MqttDownPacket> = subscription.first(NEVER_ABORTED);

    const text = 'Hello world !';

    await client.up.drain(
      ReadableFlow.of({
        topic,
        payload: text,
        qos: 0,
        retain: false,
        dup: false,
      }),
      NEVER_ABORTED,
    );

    const packet: MqttDownPacket = await packetPromise;

    expect(packet.topic).toBe(topic);
    expect(new TextDecoder().decode(packet.payload)).toBe(text);
  });
});
