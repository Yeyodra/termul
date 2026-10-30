/**
 * The record's folder as a person reads it.
 *
 * `record.dir` is already absolute, but the records store normalises a Windows
 * root to forward slashes, which turns a verbatim prefix into `//?/`. That is
 * correct for the fs plugin and wrong on screen (and wrong in a path the user
 * pastes into a chat), so the display drops it and goes back to backslashes.
 */
export function recordPath(record: { dir: string }): string {
  return record.dir.replace(/^\/\/\?\//, '').replace(/\//g, '\\')
}
