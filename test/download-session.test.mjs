import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOWNLOAD_SCAN_GRACE_MS,
  activateDownloadScan,
  deferDownloadScan,
  downloadScanAlarmName,
  downloadScanCollects,
  downloadScanState,
  parseDownloadScanAlarm,
  pauseDownloadScan
} from '../extension/core/download-session.js';

test('download discovery moves from active through a two-minute grace period to paused', () => {
  const now = 10_000;
  const active = activateDownloadScan({ active: true });
  const grace = deferDownloadScan(active, now);
  assert.equal(grace.scanDeadline, now + DOWNLOAD_SCAN_GRACE_MS);
  assert.equal(downloadScanState(grace, now + DOWNLOAD_SCAN_GRACE_MS - 1), 'grace');
  assert.equal(downloadScanCollects(grace, now + DOWNLOAD_SCAN_GRACE_MS - 1), true);
  assert.equal(downloadScanState(grace, now + DOWNLOAD_SCAN_GRACE_MS), 'paused');
  assert.equal(downloadScanCollects(grace, now + DOWNLOAD_SCAN_GRACE_MS), false);
  assert.equal(downloadScanState(pauseDownloadScan(grace), now), 'paused');
  assert.equal(downloadScanState(activateDownloadScan(grace), now), 'active');
  assert.equal(downloadScanCollects(null, now), false);
});

test('download discovery alarms identify one product and tab', () => {
  const name = downloadScanAlarmName('videoDownload', 82);
  assert.equal(name, 'downloadScanPause:videoDownload:82');
  assert.deepEqual(parseDownloadScanAlarm(name), { product: 'videoDownload', tabId: 82 });
  assert.equal(downloadScanAlarmName('unknown', 82), '');
  assert.equal(parseDownloadScanAlarm('downloadScanPause:videoDownload:not-a-tab'), null);
});
