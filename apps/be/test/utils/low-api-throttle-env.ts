/**
 * Side-effect import (like low-throttle-env): lowers the global API and gateway limits for one
 * spec file. Must come before anything that imports AppModule.
 */
export const LOW_API_LIMIT = 3;
process.env.API_THROTTLE_LIMIT = String(LOW_API_LIMIT);
process.env.GATEWAY_THROTTLE_LIMIT = String(LOW_API_LIMIT);
