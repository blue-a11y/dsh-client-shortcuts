/**
 * Global shortcuts plugin, node half.
 *
 * Deliberately empty. The whole feature is browser UI — the capture-phase
 * keydown registry and its default bindings live in `./client`, and nothing
 * here registers Host-side state or services.
 */

/** Host plugin body — no Host services are read or provided. */
export function apply(): void {}
