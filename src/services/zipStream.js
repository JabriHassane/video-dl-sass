import archiver from 'archiver';
import { extractToStream } from './extractor.js';
import { assertSafeSourceUrl } from '../security/urlValidator.js';
import { config } from '../config.js';

/**
 * Streams a playlist as a ZIP archive directly to `outputStream` (the
 * HTTP response), zero bytes ever touch disk.
 *
 * Concurrency model — "max N simultaneous streams" without buffering a
 * full video in RAM:
 *   - Up to `config.maxConcurrentPlaylistStreams` worker loops run at
 *     once, each spawning its own yt-dlp subprocess for the next
 *     not-yet-started playlist item.
 *   - A ZIP is one sequential byte stream, so `archiver` only ever reads
 *     from ONE appended entry at a time, strictly in append order.
 *   - Entries are appended to the archive in strict playlist order via
 *     the `nextToAppend` gate below. A worker that finishes item N+1
 *     before item N is done simply leaves its child process's stdout
 *     unread — the OS pipe buffer (~64KB) fills and the child blocks on
 *     write, which stalls its upstream network read. That is the
 *     backpressure mechanism: bounded by the OS pipe, not by an
 *     application-level buffer, and it costs zero disk and negligible RAM.
 */
export async function streamPlaylistAsZip({ items, format, outputStream, signal, maxItems }) {
  const bounded = maxItems === -1 ? items : items.slice(0, maxItems);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('warning', (err) => {
    if (err.code !== 'ENOENT') throw err;
  });
  archive.pipe(outputStream);

  const activeAborts = new Set();
  signal?.addEventListener('abort', () => {
    for (const abort of activeAborts) abort();
    archive.abort();
  });

  let cursor = 0;
  let nextToAppend = 0;
  const pending = new Map(); // playlist index -> { stream, name, done }

  function flushReady() {
    while (pending.has(nextToAppend)) {
      const entry = pending.get(nextToAppend);
      if (!entry.skip) {
        archive.append(entry.stream, { name: entry.name });
      }
      pending.delete(nextToAppend);
      nextToAppend += 1;
    }
  }

  async function worker() {
    for (;;) {
      if (signal?.aborted) return;
      const index = cursor;
      cursor += 1;
      if (index >= bounded.length) return;

      const item = bounded[index];

      // The outer playlist URL was validated (allowlist + DNS) before we
      // ever got here, but each *item* URL comes from the extractor's own
      // parsing of the source's response — re-validate it independently
      // rather than trusting it transitively. A crafted/compromised
      // response is the only way this would ever differ from the outer
      // domain, but the check is cheap and this is exactly the kind of
      // gap that turns into an SSRF later.
      let safeItemUrl;
      try {
        safeItemUrl = await assertSafeSourceUrl(item.url);
      } catch (err) {
        pending.set(index, { skip: true });
        console.error(`[playlist-zip] skipping "${item.title ?? item.id}": ${err.message}`);
        flushReady();
        continue;
      }

      const { stream, abort, done } = extractToStream({ url: safeItemUrl.toString(), format, signal });
      activeAborts.add(abort);

      // Don't hand a stream to archiver until we know it actually has
      // bytes: a format/availability failure makes yt-dlp exit before
      // writing anything, and archiver has no way to retract an entry
      // once appended — that's how a failed item used to end up as a
      // corrupt 0-byte file inside an otherwise-valid ZIP.
      const probe = await waitForFirstByteOrEnd(stream);
      if (probe.hasData) {
        pending.set(index, { stream, name: `${sanitizeFilename(item.title ?? item.id)}.mp4` });
      } else {
        pending.set(index, { skip: true });
        console.error(`[playlist-zip] skipping "${item.title ?? item.id}": no data produced`);
      }
      flushReady();

      try {
        await done;
      } catch (err) {
        // A single item's extraction failure shouldn't abort the whole archive.
        console.error('[playlist-zip] item extraction failed:', err.message);
      } finally {
        activeAborts.delete(abort);
      }
    }
  }

  const workerCount = Math.min(config.maxConcurrentPlaylistStreams, bounded.length) || 1;
  await Promise.all(Array.from({ length: workerCount }, worker));
  flushReady();

  if (!signal?.aborted) {
    await archive.finalize();
  }
}

/**
 * Resolves once the stream either has bytes ready to read (`hasData:
 * true`) or has ended/errored with none produced.
 *
 * Node's 'readable' event is NOT a reliable "there is data" signal on
 * its own — it also fires exactly once right before 'end' as an EOF
 * notification, with the following .read() returning null. So this
 * actually calls .read() to tell the two apart, and un-reads (unshift)
 * whatever it pulled so archiver still gets every byte afterwards —
 * nothing is lost, this is a peek, not a consume.
 */
function waitForFirstByteOrEnd(stream) {
  return new Promise((resolve) => {
    function onReadable() {
      const chunk = stream.read();
      if (chunk === null) return; // EOF signal, not real data — wait for 'end'
      stream.unshift(chunk);
      cleanup();
      resolve({ hasData: true });
    }
    function onEnded() {
      cleanup();
      resolve({ hasData: false });
    }
    function cleanup() {
      stream.removeListener('readable', onReadable);
      stream.removeListener('end', onEnded);
      stream.removeListener('error', onEnded);
    }
    stream.once('readable', onReadable);
    stream.once('end', onEnded);
    stream.once('error', onEnded);
  });
}

function sanitizeFilename(name) {
  return String(name)
    .replace(/[/\\?%*:|"<>]/g, '-')
    .slice(0, 150);
}
