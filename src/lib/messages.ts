import type { Message } from './types';

export async function send(message: Message): Promise<void> {
  const response = (await chrome.runtime.sendMessage(message)) as
    | { ok: true }
    | { ok: false; error: string }
    | undefined;
  if (response && !response.ok) throw new Error(response.error);
}
