import type { Context } from '@deepseek-ai/cordis'
import type { SessionControllerService } from '@deepseek-ai/dsh-api-session-controller'
import type { AgentsService } from '@deepseek-ai/dsh-agent'
import type { SessionQueryService } from '@deepseek-ai/dsh-session-query'
import type { ToolsService } from '@deepseek-ai/dsh-tools'

/**
 * Typed access to the Host services this plugin consumes.
 *
 * Every lookup goes through `ctx.get(name)` rather than property access so that
 * a deployment composing the plugin without one of these services produces one
 * typed error naming the missing service, instead of a `TypeError` from a
 * property read somewhere inside a tool body.
 */
export interface HostServices {
  readonly query: SessionQueryService
  readonly controller: SessionControllerService
  readonly agents: AgentsService
  readonly tools: ToolsService
}

/** One service this plugin cannot operate without, and what it is used for. */
interface Requirement {
  readonly name: string
  readonly purpose: string
}

/**
 * The consumed services, keyed by the service name.
 *
 * Keeping the reason beside the name means the boot-time diagnostic can say
 * what stopped working, which is the difference between a five-minute and a
 * one-hour debugging session.
 */
const REQUIREMENTS = {
  sessionQuery: 'read other sessions without waking them',
  sessionController: 'deliver a message into another session',
  agents: 'resolve the calling session identity',
  tools: 'register the model-facing tools',
} as const satisfies Record<string, string>

/** Look up the documented purpose of a required service. */
function purposeOf(name: keyof typeof REQUIREMENTS): string {
  return REQUIREMENTS[name]
}

/** Every requirement as a list, for diagnostics and tests. */
export const REQUIREMENTS_LIST: readonly Requirement[] = Object.entries(REQUIREMENTS).map(
  ([name, purpose]) => ({ name, purpose }),
)

/** Thrown when a required Host service is absent from this composition. */
export class MissingServiceError extends Error {
  public readonly service: string

  public constructor(service: string, purpose: string) {
    super(
      `@mrhuangjser/dsh-cross-session requires the "${service}" Host service (${purpose}), but this ` +
        `deployment does not compose it. Add the plugin that provides "${service}" to the ` +
        `host composition, or disable this plugin.`,
    )
    this.name = 'MissingServiceError'
    this.service = service
  }
}

/**
 * Resolve one required service.
 *
 * `ctx.get` is typed as returning `unknown`, so the caller states the shape it
 * expects; a deployment that composes a different implementation of the same
 * service key is out of contract, and the tool bodies fail loudly rather than
 * silently when that happens.
 */
function requireService(ctx: Context, name: string, purpose: string): unknown {
  const found = ctx.get(name)
  if (found === undefined || found === null) throw new MissingServiceError(name, purpose)
  return found
}

/**
 * Resolve every service the plugin needs, or throw naming the first missing one.
 *
 * Called at apply time so a misconfigured deployment fails loudly at mount
 * rather than when a model first calls a tool.
 */
export function resolveHostServices(ctx: Context): HostServices {
  return {
    query: requireService(ctx, 'sessionQuery', purposeOf('sessionQuery')) as SessionQueryService,
    controller: requireService(
      ctx,
      'sessionController',
      purposeOf('sessionController'),
    ) as SessionControllerService,
    agents: requireService(ctx, 'agents', purposeOf('agents')) as AgentsService,
    tools: requireService(ctx, 'tools', purposeOf('tools')) as ToolsService,
  }
}
