import type { OffscreenCopyMessage } from '../background/clipboard';

const buffer = document.getElementById('buffer') as HTMLTextAreaElement;

chrome.runtime.onMessage.addListener((message: Partial<OffscreenCopyMessage>, _sender, respond) => {
  if (message.offscreen !== 'copy' || typeof message.text !== 'string') return false;
  // navigator.clipboard needs document focus, which offscreen documents never have.
  buffer.value = message.text;
  buffer.select();
  respond(document.execCommand('copy'));
  return false;
});
