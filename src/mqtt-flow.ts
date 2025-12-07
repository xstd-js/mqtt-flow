import { type Abortable } from '@xstd/abortable';
import { CompleteError } from '@xstd/custom-error';
import { getAsyncEnumeratorNextValue } from '@xstd/enumerable';
import {
  Drain,
  Flow,
  type FlowContext,
  type FlowForkOptions,
  type FlowIterator,
  type PushBridge,
  type PushToPullOptions,
} from '@xstd/flow';
import {
  type MqttPublishPacket,
  MqttResource,
  type MqttResourceOpenOptions,
  type MqttResourcePublishOptions,
  type MqttResourcePublishPayload,
  type MqttResourceSubscribeOptions,
  type MqttSubscriptionResource,
} from '@xstd/mqtt-resource';

export interface MqttFlowOptions
  extends Omit<MqttResourceOpenOptions, keyof Abortable>, FlowForkOptions {}

export interface MqttFlowUpPacket extends MqttResourcePublishOptions {
  readonly topic: string;
  readonly payload: MqttResourcePublishPayload;
}

export interface MqttFlowDownPacket extends MqttPublishPacket {}

export interface MqttFlowSubscriptionOptions extends Omit<
  MqttResourceSubscribeOptions,
  keyof Abortable
> {}

export class MqttFlow {
  readonly #sharedMqttClientFlow: Flow<MqttResource>;

  readonly #up: Drain<MqttFlowUpPacket>;

  constructor(url: string | URL, mqttOptions?: MqttFlowOptions) {
    this.#sharedMqttClientFlow = new Flow<MqttResource>(async function* ({
      signal,
    }: FlowContext): FlowIterator<MqttResource> {
      signal.throwIfAborted();
      await using client: MqttResource = await MqttResource.open(url, mqttOptions);

      while (!client.closeSignal.aborted) {
        yield client;
        signal.throwIfAborted();
      }

      throw new Error('MqttClient closed.');
    }).fork(mqttOptions);

    this.#up = new Drain<MqttFlowUpPacket>(
      async (flow: Flow<MqttFlowUpPacket>, signal: AbortSignal): Promise<void> => {
        signal.throwIfAborted();

        await using stack: AsyncDisposableStack = new AsyncDisposableStack();

        const client: MqttResource = await getAsyncEnumeratorNextValue(
          stack.use(this.#sharedMqttClientFlow.open(signal)),
        );

        for await (const { topic, payload, ...options } of flow.open(signal)) {
          await client.publish(topic, payload, {
            ...options,
            signal,
          });
        }
      },
    );
  }

  get up(): Drain<MqttFlowUpPacket> {
    return this.#up;
  }

  subscription(
    topic: string,
    options?: MqttFlowSubscriptionOptions,
  ): Flow<MqttFlowDownPacket, [options?: PushToPullOptions]> {
    return this.#sharedMqttClientFlow.flatMap(
      (client: MqttResource): Flow<MqttFlowDownPacket, [options?: PushToPullOptions]> => {
        return Flow.fromPushSource<MqttFlowDownPacket>(
          async ({
            next,
            error,
            complete,
            signal,
            stack,
          }: PushBridge<MqttFlowDownPacket>): Promise<void> => {
            const subscription: MqttSubscriptionResource = stack.use(
              await client.subscribe(topic, options),
            );

            subscription.listen(next);

            subscription.closeSignal.addEventListener(
              'abort',
              (): void => {
                if (!signal.aborted) {
                  const reason: unknown = subscription.closeSignal.reason;
                  if (reason instanceof CompleteError) {
                    complete();
                  } else {
                    error(reason);
                  }
                }
              },
              {
                signal,
              },
            );
          },
        );
      },
    );
  }
}
