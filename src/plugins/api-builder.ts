import type { AlienConfig } from "../config/types.alien.js";
import type { PluginRuntime } from "./runtime/types.js";
import type { AlienPluginApi, PluginLogger } from "./types.js";

export type BuildPluginApiParams = {
  id: string;
  name: string;
  version?: string;
  description?: string;
  source: string;
  rootDir?: string;
  registrationMode: AlienPluginApi["registrationMode"];
  config: AlienConfig;
  pluginConfig?: Record<string, unknown>;
  runtime: PluginRuntime;
  logger: PluginLogger;
  resolvePath: (input: string) => string;
  handlers?: Partial<
    Pick<
      AlienPluginApi,
      | "registerTool"
      | "registerHook"
      | "registerHttpRoute"
      | "registerChannel"
      | "registerGatewayMethod"
      | "registerCli"
      | "registerReload"
      | "registerNodeHostCommand"
      | "registerNodeInvokePolicy"
      | "registerSecurityAuditCollector"
      | "registerService"
      | "registerGatewayDiscoveryService"
      | "registerCliBackend"
      | "registerTextTransforms"
      | "registerConfigMigration"
      | "registerMigrationProvider"
      | "registerAutoEnableProbe"
      | "registerProvider"
      | "registerSpeechProvider"
      | "registerRealtimeTranscriptionProvider"
      | "registerRealtimeVoiceProvider"
      | "registerMediaUnderstandingProvider"
      | "registerImageGenerationProvider"
      | "registerVideoGenerationProvider"
      | "registerMusicGenerationProvider"
      | "registerWebFetchProvider"
      | "registerWebSearchProvider"
      | "registerInteractiveHandler"
      | "onConversationBindingResolved"
      | "registerCommand"
      | "registerContextEngine"
      | "registerCompactionProvider"
      | "registerAgentHarness"
      | "registerCodexAppServerExtensionFactory"
      | "registerAgentToolResultMiddleware"
      | "registerSessionExtension"
      | "enqueueNextTurnInjection"
      | "registerTrustedToolPolicy"
      | "registerToolMetadata"
      | "registerControlUiDescriptor"
      | "registerRuntimeLifecycle"
      | "registerAgentEventSubscription"
      | "setRunContext"
      | "getRunContext"
      | "clearRunContext"
      | "registerSessionSchedulerJob"
      | "registerDetachedTaskRuntime"
      | "registerMemoryCapability"
      | "registerMemoryPromptSection"
      | "registerMemoryPromptSupplement"
      | "registerMemoryCorpusSupplement"
      | "registerMemoryFlushPlan"
      | "registerMemoryRuntime"
      | "registerMemoryEmbeddingProvider"
      | "on"
    >
  >;
};

const noopRegisterTool: AlienPluginApi["registerTool"] = () => {};
const noopRegisterHook: AlienPluginApi["registerHook"] = () => {};
const noopRegisterHttpRoute: AlienPluginApi["registerHttpRoute"] = () => {};
const noopRegisterChannel: AlienPluginApi["registerChannel"] = () => {};
const noopRegisterGatewayMethod: AlienPluginApi["registerGatewayMethod"] = () => {};
const noopRegisterCli: AlienPluginApi["registerCli"] = () => {};
const noopRegisterReload: AlienPluginApi["registerReload"] = () => {};
const noopRegisterNodeHostCommand: AlienPluginApi["registerNodeHostCommand"] = () => {};
const noopRegisterNodeInvokePolicy: AlienPluginApi["registerNodeInvokePolicy"] = () => {};
const noopRegisterSecurityAuditCollector: AlienPluginApi["registerSecurityAuditCollector"] =
  () => {};
const noopRegisterService: AlienPluginApi["registerService"] = () => {};
const noopRegisterGatewayDiscoveryService: AlienPluginApi["registerGatewayDiscoveryService"] =
  () => {};
const noopRegisterCliBackend: AlienPluginApi["registerCliBackend"] = () => {};
const noopRegisterTextTransforms: AlienPluginApi["registerTextTransforms"] = () => {};
const noopRegisterConfigMigration: AlienPluginApi["registerConfigMigration"] = () => {};
const noopRegisterMigrationProvider: AlienPluginApi["registerMigrationProvider"] = () => {};
const noopRegisterAutoEnableProbe: AlienPluginApi["registerAutoEnableProbe"] = () => {};
const noopRegisterProvider: AlienPluginApi["registerProvider"] = () => {};
const noopRegisterSpeechProvider: AlienPluginApi["registerSpeechProvider"] = () => {};
const noopRegisterRealtimeTranscriptionProvider: AlienPluginApi["registerRealtimeTranscriptionProvider"] =
  () => {};
const noopRegisterRealtimeVoiceProvider: AlienPluginApi["registerRealtimeVoiceProvider"] =
  () => {};
const noopRegisterMediaUnderstandingProvider: AlienPluginApi["registerMediaUnderstandingProvider"] =
  () => {};
const noopRegisterImageGenerationProvider: AlienPluginApi["registerImageGenerationProvider"] =
  () => {};
const noopRegisterVideoGenerationProvider: AlienPluginApi["registerVideoGenerationProvider"] =
  () => {};
const noopRegisterMusicGenerationProvider: AlienPluginApi["registerMusicGenerationProvider"] =
  () => {};
const noopRegisterWebFetchProvider: AlienPluginApi["registerWebFetchProvider"] = () => {};
const noopRegisterWebSearchProvider: AlienPluginApi["registerWebSearchProvider"] = () => {};
const noopRegisterInteractiveHandler: AlienPluginApi["registerInteractiveHandler"] = () => {};
const noopOnConversationBindingResolved: AlienPluginApi["onConversationBindingResolved"] =
  () => {};
const noopRegisterCommand: AlienPluginApi["registerCommand"] = () => {};
const noopRegisterContextEngine: AlienPluginApi["registerContextEngine"] = () => {};
const noopRegisterCompactionProvider: AlienPluginApi["registerCompactionProvider"] = () => {};
const noopRegisterAgentHarness: AlienPluginApi["registerAgentHarness"] = () => {};
const noopRegisterCodexAppServerExtensionFactory: AlienPluginApi["registerCodexAppServerExtensionFactory"] =
  () => {};
const noopRegisterAgentToolResultMiddleware: AlienPluginApi["registerAgentToolResultMiddleware"] =
  () => {};
const noopRegisterSessionExtension: AlienPluginApi["registerSessionExtension"] = () => {};
const noopEnqueueNextTurnInjection: AlienPluginApi["enqueueNextTurnInjection"] = async (
  injection,
) => ({ enqueued: false, id: "", sessionKey: injection.sessionKey });
const noopRegisterTrustedToolPolicy: AlienPluginApi["registerTrustedToolPolicy"] = () => {};
const noopRegisterToolMetadata: AlienPluginApi["registerToolMetadata"] = () => {};
const noopRegisterControlUiDescriptor: AlienPluginApi["registerControlUiDescriptor"] = () => {};
const noopRegisterRuntimeLifecycle: AlienPluginApi["registerRuntimeLifecycle"] = () => {};
const noopRegisterAgentEventSubscription: AlienPluginApi["registerAgentEventSubscription"] =
  () => {};
const noopSetRunContext: AlienPluginApi["setRunContext"] = () => false;
const noopGetRunContext: AlienPluginApi["getRunContext"] = () => undefined;
const noopClearRunContext: AlienPluginApi["clearRunContext"] = () => {};
const noopRegisterSessionSchedulerJob: AlienPluginApi["registerSessionSchedulerJob"] = () =>
  undefined;
const noopRegisterDetachedTaskRuntime: AlienPluginApi["registerDetachedTaskRuntime"] = () => {};
const noopRegisterMemoryCapability: AlienPluginApi["registerMemoryCapability"] = () => {};
const noopRegisterMemoryPromptSection: AlienPluginApi["registerMemoryPromptSection"] = () => {};
const noopRegisterMemoryPromptSupplement: AlienPluginApi["registerMemoryPromptSupplement"] =
  () => {};
const noopRegisterMemoryCorpusSupplement: AlienPluginApi["registerMemoryCorpusSupplement"] =
  () => {};
const noopRegisterMemoryFlushPlan: AlienPluginApi["registerMemoryFlushPlan"] = () => {};
const noopRegisterMemoryRuntime: AlienPluginApi["registerMemoryRuntime"] = () => {};
const noopRegisterMemoryEmbeddingProvider: AlienPluginApi["registerMemoryEmbeddingProvider"] =
  () => {};
const noopOn: AlienPluginApi["on"] = () => {};

export function buildPluginApi(params: BuildPluginApiParams): AlienPluginApi {
  const handlers = params.handlers ?? {};
  return {
    id: params.id,
    name: params.name,
    version: params.version,
    description: params.description,
    source: params.source,
    rootDir: params.rootDir,
    registrationMode: params.registrationMode,
    config: params.config,
    pluginConfig: params.pluginConfig,
    runtime: params.runtime,
    logger: params.logger,
    registerTool: handlers.registerTool ?? noopRegisterTool,
    registerHook: handlers.registerHook ?? noopRegisterHook,
    registerHttpRoute: handlers.registerHttpRoute ?? noopRegisterHttpRoute,
    registerChannel: handlers.registerChannel ?? noopRegisterChannel,
    registerGatewayMethod: handlers.registerGatewayMethod ?? noopRegisterGatewayMethod,
    registerCli: handlers.registerCli ?? noopRegisterCli,
    registerReload: handlers.registerReload ?? noopRegisterReload,
    registerNodeHostCommand: handlers.registerNodeHostCommand ?? noopRegisterNodeHostCommand,
    registerNodeInvokePolicy: handlers.registerNodeInvokePolicy ?? noopRegisterNodeInvokePolicy,
    registerSecurityAuditCollector:
      handlers.registerSecurityAuditCollector ?? noopRegisterSecurityAuditCollector,
    registerService: handlers.registerService ?? noopRegisterService,
    registerGatewayDiscoveryService:
      handlers.registerGatewayDiscoveryService ?? noopRegisterGatewayDiscoveryService,
    registerCliBackend: handlers.registerCliBackend ?? noopRegisterCliBackend,
    registerTextTransforms: handlers.registerTextTransforms ?? noopRegisterTextTransforms,
    registerConfigMigration: handlers.registerConfigMigration ?? noopRegisterConfigMigration,
    registerMigrationProvider: handlers.registerMigrationProvider ?? noopRegisterMigrationProvider,
    registerAutoEnableProbe: handlers.registerAutoEnableProbe ?? noopRegisterAutoEnableProbe,
    registerProvider: handlers.registerProvider ?? noopRegisterProvider,
    registerSpeechProvider: handlers.registerSpeechProvider ?? noopRegisterSpeechProvider,
    registerRealtimeTranscriptionProvider:
      handlers.registerRealtimeTranscriptionProvider ?? noopRegisterRealtimeTranscriptionProvider,
    registerRealtimeVoiceProvider:
      handlers.registerRealtimeVoiceProvider ?? noopRegisterRealtimeVoiceProvider,
    registerMediaUnderstandingProvider:
      handlers.registerMediaUnderstandingProvider ?? noopRegisterMediaUnderstandingProvider,
    registerImageGenerationProvider:
      handlers.registerImageGenerationProvider ?? noopRegisterImageGenerationProvider,
    registerVideoGenerationProvider:
      handlers.registerVideoGenerationProvider ?? noopRegisterVideoGenerationProvider,
    registerMusicGenerationProvider:
      handlers.registerMusicGenerationProvider ?? noopRegisterMusicGenerationProvider,
    registerWebFetchProvider: handlers.registerWebFetchProvider ?? noopRegisterWebFetchProvider,
    registerWebSearchProvider: handlers.registerWebSearchProvider ?? noopRegisterWebSearchProvider,
    registerInteractiveHandler:
      handlers.registerInteractiveHandler ?? noopRegisterInteractiveHandler,
    onConversationBindingResolved:
      handlers.onConversationBindingResolved ?? noopOnConversationBindingResolved,
    registerCommand: handlers.registerCommand ?? noopRegisterCommand,
    registerContextEngine: handlers.registerContextEngine ?? noopRegisterContextEngine,
    registerCompactionProvider:
      handlers.registerCompactionProvider ?? noopRegisterCompactionProvider,
    registerAgentHarness: handlers.registerAgentHarness ?? noopRegisterAgentHarness,
    registerCodexAppServerExtensionFactory:
      handlers.registerCodexAppServerExtensionFactory ?? noopRegisterCodexAppServerExtensionFactory,
    registerAgentToolResultMiddleware:
      handlers.registerAgentToolResultMiddleware ?? noopRegisterAgentToolResultMiddleware,
    registerSessionExtension: handlers.registerSessionExtension ?? noopRegisterSessionExtension,
    enqueueNextTurnInjection: handlers.enqueueNextTurnInjection ?? noopEnqueueNextTurnInjection,
    registerTrustedToolPolicy: handlers.registerTrustedToolPolicy ?? noopRegisterTrustedToolPolicy,
    registerToolMetadata: handlers.registerToolMetadata ?? noopRegisterToolMetadata,
    registerControlUiDescriptor:
      handlers.registerControlUiDescriptor ?? noopRegisterControlUiDescriptor,
    registerRuntimeLifecycle: handlers.registerRuntimeLifecycle ?? noopRegisterRuntimeLifecycle,
    registerAgentEventSubscription:
      handlers.registerAgentEventSubscription ?? noopRegisterAgentEventSubscription,
    setRunContext: handlers.setRunContext ?? noopSetRunContext,
    getRunContext: handlers.getRunContext ?? noopGetRunContext,
    clearRunContext: handlers.clearRunContext ?? noopClearRunContext,
    registerSessionSchedulerJob:
      handlers.registerSessionSchedulerJob ?? noopRegisterSessionSchedulerJob,
    registerDetachedTaskRuntime:
      handlers.registerDetachedTaskRuntime ?? noopRegisterDetachedTaskRuntime,
    registerMemoryCapability: handlers.registerMemoryCapability ?? noopRegisterMemoryCapability,
    registerMemoryPromptSection:
      handlers.registerMemoryPromptSection ?? noopRegisterMemoryPromptSection,
    registerMemoryPromptSupplement:
      handlers.registerMemoryPromptSupplement ?? noopRegisterMemoryPromptSupplement,
    registerMemoryCorpusSupplement:
      handlers.registerMemoryCorpusSupplement ?? noopRegisterMemoryCorpusSupplement,
    registerMemoryFlushPlan: handlers.registerMemoryFlushPlan ?? noopRegisterMemoryFlushPlan,
    registerMemoryRuntime: handlers.registerMemoryRuntime ?? noopRegisterMemoryRuntime,
    registerMemoryEmbeddingProvider:
      handlers.registerMemoryEmbeddingProvider ?? noopRegisterMemoryEmbeddingProvider,
    resolvePath: params.resolvePath,
    on: handlers.on ?? noopOn,
  };
}
