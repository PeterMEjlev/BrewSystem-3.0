/**
 * LTTB (Largest Triangle Three Buckets) downsampling for time-series data.
 * Preserves the visual shape of the curve while reducing point count.
 * Uses 'BK' as the Y-dimension for triangle area computation, driving
 * index selection for all series (BK, MLT, HLT share the same X axis).
 *
 * @param {Array<{ts: number, BK: number, MLT: number, HLT: number}>} data - Input sorted by ts ascending
 * @param {number} threshold - Maximum output point count
 * @returns {Array} - Downsampled array of the same shape as input
 */
export function lttbDownsample(data, threshold) {
  const len = data.length;
  if (threshold < 3 || len <= threshold) return data;

  const sampled = [data[0]];
  const bucketCount = threshold - 2;
  const bucketSize = (len - 2) / bucketCount;
  const yKey = 'BK';
  let prevSelectedIndex = 0;

  for (let i = 0; i < bucketCount; i++) {
    // Compute centroid of the next bucket (used as the far vertex of the triangle)
    const nextBucketStart = Math.floor((i + 1) * bucketSize) + 1;
    const nextBucketEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, len - 1);
    const nextBucketLen = nextBucketEnd - nextBucketStart;
    let avgTs = 0, avgVal = 0;
    for (let j = nextBucketStart; j < nextBucketEnd; j++) {
      avgTs += data[j].ts;
      avgVal += data[j][yKey] ?? 0;
    }
    avgTs /= nextBucketLen;
    avgVal /= nextBucketLen;

    // Find the point in the current bucket that forms the largest triangle
    const currentBucketStart = Math.floor(i * bucketSize) + 1;
    const currentBucketEnd = Math.floor((i + 1) * bucketSize) + 1;
    const pointA = data[prevSelectedIndex];
    let maxArea = -1, maxIndex = currentBucketStart;
    for (let j = currentBucketStart; j < currentBucketEnd; j++) {
      const area = Math.abs(
        (pointA.ts - avgTs) * (data[j][yKey] - pointA[yKey]) -
        (pointA.ts - data[j].ts) * (avgVal - pointA[yKey])
      );
      if (area > maxArea) { maxArea = area; maxIndex = j; }
    }
    sampled.push(data[maxIndex]);
    prevSelectedIndex = maxIndex;
  }

  sampled.push(data[len - 1]);
  return sampled;
}
