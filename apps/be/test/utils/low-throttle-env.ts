/**
 * Side-effect import: must come before anything that imports AppModule, because
 * ConfigModule.forRoot reads env when AppModule is first loaded. Jest gives each spec
 * file its own process.env copy, so the low limit cannot leak into other files.
 */
export const LOW_THROTTLE_LIMIT = 3;
process.env.AUTH_THROTTLE_LIMIT = String(LOW_THROTTLE_LIMIT);
