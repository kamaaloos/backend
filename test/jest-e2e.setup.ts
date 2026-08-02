import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../.env') });

process.env.THROTTLE_LIMIT ??= '10000';
process.env.THROTTLE_TTL_MS ??= '60000';
// Avoid Socket.IO Redis adapter issues under Jest (no HTTP listen).
process.env.REDIS_SOCKET_ADAPTER = 'false';
