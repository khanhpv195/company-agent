/**
 * Side-effect import: must come before anything that imports AppModule (see low-throttle-env).
 * Turns the in-process agent simulator on for one spec file.
 */
process.env.AGENT_SIMULATOR = 'true';
