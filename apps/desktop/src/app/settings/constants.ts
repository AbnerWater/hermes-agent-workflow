import {
  Brain,
  type IconComponent,
  Lock,
  MessageCircle,
  Mic,
  Monitor,
  Moon,
  Palette,
  Sparkles,
  Sun,
  Wrench
} from '@/lib/icons'
import type { AppLanguage } from '@/store/app-language'
import type { ThemeMode } from '@/themes/context'

import type { DesktopConfigSection } from './types'

// Provider group definitions used to fold raw env-var names like
// ``XAI_API_KEY`` into a single "xAI" card with a friendly label, short
// description, and signup URL. Membership is determined by longest
// prefix match (see ``providerGroup`` in helpers.ts) so more specific
// prefixes (``MINIMAX_CN_``) correctly beat their general parents
// (``MINIMAX_``). New providers should be added here so they get their
// own card in Settings → Keys instead of being lumped into "Other".
interface ProviderPrefix {
  prefix: string
  name: string
  /** Optional one-line tagline shown beneath the group name. */
  description?: string
  /** Optional canonical signup/console URL surfaced from the card header. */
  docsUrl?: string
  /** Lower numbers float to the top of the providers list. */
  priority: number
}

export const EMPTY_SELECT_VALUE = '__hermes_empty__'
export const CONTROL_TEXT = 'text-xs'

export const PROVIDER_GROUPS: ProviderPrefix[] = [
  {
    prefix: 'NOUS_',
    name: 'Nous Portal',
    description: 'Hosted Hermes & Nous-trained models',
    docsUrl: 'https://portal.nousresearch.com',
    priority: 0
  },
  {
    prefix: 'OPENROUTER_',
    name: 'OpenRouter',
    description: 'Aggregator for hundreds of frontier models',
    docsUrl: 'https://openrouter.ai/keys',
    priority: 1
  },
  {
    prefix: 'ANTHROPIC_',
    name: 'Anthropic',
    description: 'Claude API access (Sonnet, Opus, Haiku)',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    priority: 2
  },
  {
    prefix: 'XAI_',
    name: 'xAI',
    description: 'Grok models (use OAuth for SuperGrok / Premium+)',
    docsUrl: 'https://console.x.ai/',
    priority: 3
  },
  {
    prefix: 'GOOGLE_',
    name: 'Gemini',
    description: 'Google AI Studio (Gemini 1.5 / 2.0 / 2.5)',
    docsUrl: 'https://aistudio.google.com/app/apikey',
    priority: 4
  },
  { prefix: 'GEMINI_', name: 'Gemini', priority: 4 },
  { prefix: 'HERMES_GEMINI_', name: 'Gemini', priority: 4 },
  {
    prefix: 'DEEPSEEK_',
    name: 'DeepSeek',
    description: 'Direct DeepSeek API (V3.x, R1)',
    docsUrl: 'https://platform.deepseek.com/api_keys',
    priority: 5
  },
  {
    prefix: 'DASHSCOPE_',
    name: 'DashScope (Qwen)',
    description: 'Alibaba Cloud DashScope — Qwen and multi-vendor models',
    docsUrl: 'https://modelstudio.console.alibabacloud.com/',
    priority: 6
  },
  { prefix: 'HERMES_QWEN_', name: 'DashScope (Qwen)', priority: 6 },
  {
    prefix: 'GLM_',
    name: 'GLM / Z.AI',
    description: 'Zhipu GLM-4.6 and Z.AI hosted endpoints',
    docsUrl: 'https://z.ai/',
    priority: 7
  },
  { prefix: 'ZAI_', name: 'GLM / Z.AI', priority: 7 },
  { prefix: 'Z_AI_', name: 'GLM / Z.AI', priority: 7 },
  {
    prefix: 'KIMI_',
    name: 'Kimi / Moonshot',
    description: 'Moonshot Kimi K2 / coding endpoints',
    docsUrl: 'https://platform.moonshot.cn/',
    priority: 8
  },
  {
    prefix: 'KIMI_CN_',
    name: 'Kimi (China)',
    description: 'Moonshot China endpoint',
    docsUrl: 'https://platform.moonshot.cn/',
    priority: 9
  },
  {
    prefix: 'MINIMAX_',
    name: 'MiniMax',
    description: 'MiniMax-M2 and Hailuo international endpoints',
    docsUrl: 'https://www.minimax.io/',
    priority: 10
  },
  {
    prefix: 'MINIMAX_CN_',
    name: 'MiniMax (China)',
    description: 'MiniMax mainland China endpoint',
    docsUrl: 'https://www.minimaxi.com/',
    priority: 11
  },
  {
    prefix: 'HF_',
    name: 'Hugging Face',
    description: 'Inference Providers — 20+ open models via router.huggingface.co',
    docsUrl: 'https://huggingface.co/settings/tokens',
    priority: 12
  },
  {
    prefix: 'OPENCODE_ZEN_',
    name: 'OpenCode Zen',
    description: 'Pay-as-you-go access to curated coding models',
    docsUrl: 'https://opencode.ai/auth',
    priority: 13
  },
  {
    prefix: 'OPENCODE_GO_',
    name: 'OpenCode Go',
    description: '$10/month subscription for open coding models',
    docsUrl: 'https://opencode.ai/auth',
    priority: 14
  },
  {
    prefix: 'NVIDIA_',
    name: 'NVIDIA NIM',
    description: 'build.nvidia.com or your own local NIM endpoint',
    docsUrl: 'https://build.nvidia.com/',
    priority: 15
  },
  {
    prefix: 'OLLAMA_',
    name: 'Ollama Cloud',
    description: 'Cloud-hosted open models from ollama.com',
    docsUrl: 'https://ollama.com/settings',
    priority: 16
  },
  {
    prefix: 'LM_',
    name: 'LM Studio',
    description: 'Local LM Studio server (OpenAI-compatible)',
    docsUrl: 'https://lmstudio.ai/docs/local-server',
    priority: 17
  },
  {
    prefix: 'STEPFUN_',
    name: 'StepFun',
    description: 'StepFun Step Plan coding models',
    docsUrl: 'https://platform.stepfun.com/',
    priority: 18
  },
  {
    prefix: 'XIAOMI_',
    name: 'Xiaomi MiMo',
    description: 'MiMo-V2.5 and Xiaomi proprietary models',
    docsUrl: 'https://platform.xiaomimimo.com',
    priority: 19
  },
  {
    prefix: 'ARCEEAI_',
    name: 'Arcee AI',
    description: 'Arcee-hosted small + medium models',
    docsUrl: 'https://chat.arcee.ai/',
    priority: 20
  },
  { prefix: 'ARCEE_', name: 'Arcee AI', priority: 20 },
  {
    prefix: 'GMI_',
    name: 'GMI Cloud',
    description: 'GMI Cloud GPU + model serving',
    docsUrl: 'https://www.gmicloud.ai/',
    priority: 21
  },
  {
    prefix: 'AZURE_FOUNDRY_',
    name: 'Azure Foundry',
    description: 'Azure AI Foundry custom endpoints (OpenAI / Anthropic-compatible)',
    docsUrl: 'https://ai.azure.com/',
    priority: 22
  },
  {
    prefix: 'AWS_',
    name: 'AWS Bedrock',
    description: 'Authenticate via AWS profile + region',
    docsUrl: 'https://docs.aws.amazon.com/bedrock/latest/userguide/bedrock-regions.html',
    priority: 23
  }
]

export const BUILTIN_PERSONALITIES = [
  'helpful',
  'concise',
  'technical',
  'creative',
  'teacher',
  'kawaii',
  'catgirl',
  'pirate',
  'shakespeare',
  'surfer',
  'noir',
  'uwu',
  'philosopher',
  'hype'
]

// Schema-side select overrides for desktop-relevant enum fields whose
// backend schema only declares a string type.
export const ENUM_OPTIONS: Record<string, string[]> = {
  'agent.image_input_mode': ['auto', 'native', 'text'],
  'approvals.mode': ['manual', 'smart', 'off'],
  'code_execution.mode': ['project', 'strict'],
  'context.engine': ['compressor', 'default', 'custom'],
  'delegation.reasoning_effort': ['', 'minimal', 'low', 'medium', 'high', 'xhigh'],
  'memory.provider': ['', 'builtin', 'honcho'],
  'stt.elevenlabs.model_id': ['scribe_v2', 'scribe_v1'],
  'stt.local.model': ['tiny', 'base', 'small', 'medium', 'large-v3'],
  'tts.openai.voice': ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']
}

export const FIELD_LABELS: Record<string, string> = {
  model: 'Default Model',
  model_context_length: 'Context Window',
  fallback_providers: 'Fallback Models',
  toolsets: 'Enabled Toolsets',
  timezone: 'Timezone',
  'display.personality': 'Personality',
  'display.show_reasoning': 'Reasoning Blocks',
  'agent.max_turns': 'Max Agent Steps',
  'agent.image_input_mode': 'Image Attachments',
  'terminal.cwd': 'Working Directory',
  'terminal.backend': 'Execution Backend',
  'terminal.timeout': 'Command Timeout',
  'terminal.persistent_shell': 'Persistent Shell',
  'terminal.env_passthrough': 'Environment Passthrough',
  file_read_max_chars: 'File Read Limit',
  'tool_output.max_bytes': 'Terminal Output Limit',
  'tool_output.max_lines': 'File Page Limit',
  'tool_output.max_line_length': 'Line Length Limit',
  'code_execution.mode': 'Code Execution Mode',
  'approvals.mode': 'Approval Mode',
  'approvals.timeout': 'Approval Timeout',
  'approvals.mcp_reload_confirm': 'Confirm MCP Reloads',
  command_allowlist: 'Command Allowlist',
  'security.redact_secrets': 'Redact Secrets',
  'security.allow_private_urls': 'Allow Private URLs',
  'browser.allow_private_urls': 'Browser Private URLs',
  'browser.auto_local_for_private_urls': 'Local Browser For Private URLs',
  'checkpoints.enabled': 'File Checkpoints',
  'checkpoints.max_snapshots': 'Checkpoint Limit',
  'voice.record_key': 'Voice Shortcut',
  'voice.max_recording_seconds': 'Max Recording Length',
  'voice.auto_tts': 'Read Responses Aloud',
  'stt.enabled': 'Speech To Text',
  'stt.provider': 'Speech-To-Text Provider',
  'stt.local.model': 'Local Transcription Model',
  'stt.local.language': 'Transcription Language',
  'stt.elevenlabs.model_id': 'ElevenLabs STT Model',
  'stt.elevenlabs.language_code': 'ElevenLabs Language',
  'stt.elevenlabs.tag_audio_events': 'Tag Audio Events',
  'stt.elevenlabs.diarize': 'Speaker Diarization',
  'tts.provider': 'Text-To-Speech Provider',
  'tts.edge.voice': 'Edge Voice',
  'tts.openai.model': 'OpenAI TTS Model',
  'tts.openai.voice': 'OpenAI Voice',
  'tts.elevenlabs.voice_id': 'ElevenLabs Voice',
  'tts.elevenlabs.model_id': 'ElevenLabs Model',
  'memory.memory_enabled': 'Persistent Memory',
  'memory.user_profile_enabled': 'User Profile',
  'memory.memory_char_limit': 'Memory Budget',
  'memory.user_char_limit': 'Profile Budget',
  'memory.provider': 'Memory Provider',
  'context.engine': 'Context Engine',
  'compression.enabled': 'Auto-Compression',
  'compression.threshold': 'Compression Threshold',
  'compression.target_ratio': 'Compression Target',
  'compression.protect_last_n': 'Protected Recent Messages',
  'agent.api_max_retries': 'API Retries',
  'agent.service_tier': 'Service Tier',
  'agent.tool_use_enforcement': 'Tool-Use Enforcement',
  'delegation.model': 'Subagent Model',
  'delegation.provider': 'Subagent Provider',
  'delegation.max_iterations': 'Subagent Turn Limit',
  'delegation.max_concurrent_children': 'Parallel Subagents',
  'delegation.child_timeout_seconds': 'Subagent Timeout',
  'delegation.reasoning_effort': 'Subagent Reasoning Effort'
}

export const FIELD_DESCRIPTIONS: Record<string, string> = {
  model: 'Used for new chats unless you pick a different model in the composer.',
  model_context_length: "Leave at 0 to use the selected model's detected context window.",
  fallback_providers: 'Backup provider:model entries to try if the default model fails.',
  'display.personality': 'Default assistant style for new sessions.',
  timezone: 'Used when Hermes needs local time context. Blank uses the system timezone.',
  'display.show_reasoning': 'Show reasoning sections when the backend provides them.',
  'agent.image_input_mode': 'Controls how image attachments are sent to the model.',
  'terminal.cwd': 'Default project folder for tool and terminal work.',
  'code_execution.mode': 'How strictly code execution is scoped to the current project.',
  'terminal.persistent_shell': 'Keep shell state between commands when the backend supports it.',
  'terminal.env_passthrough': 'Environment variables to pass into tool execution.',
  file_read_max_chars: 'Maximum characters Hermes can read from one file request.',
  'approvals.mode': 'How Hermes handles commands that need explicit approval.',
  'approvals.timeout': 'How long approval prompts wait before timing out.',
  'security.redact_secrets': 'Hide detected secrets from model-visible content when possible.',
  'checkpoints.enabled': 'Create rollback snapshots before file edits.',
  'memory.memory_enabled': 'Save durable memories that can help future sessions.',
  'memory.user_profile_enabled': 'Maintain a compact profile of user preferences.',
  'context.engine': 'Strategy for managing long conversations near the context limit.',
  'compression.enabled': 'Summarize older context when conversations get large.',
  'voice.auto_tts': 'Automatically speak assistant responses.',
  'stt.enabled': 'Enable local or provider-backed speech transcription.',
  'stt.elevenlabs.language_code': 'Optional ISO-639-3 language code. Blank lets ElevenLabs auto-detect.',
  'agent.max_turns': 'Upper bound for tool-calling turns before Hermes stops a run.'
}

// Curated desktop config surface: only fields a user might tune from the app.
export const SECTIONS: DesktopConfigSection[] = [
  {
    id: 'model',
    label: 'Model',
    icon: Sparkles,
    keys: ['model_context_length', 'fallback_providers']
  },
  {
    id: 'chat',
    label: 'Chat',
    icon: MessageCircle,
    keys: ['display.personality', 'timezone', 'display.show_reasoning', 'agent.image_input_mode']
  },
  {
    id: 'appearance',
    label: 'Appearance',
    icon: Palette,
    keys: []
  },
  {
    id: 'workspace',
    label: 'Workspace',
    icon: Monitor,
    keys: [
      'terminal.cwd',
      'code_execution.mode',
      'terminal.persistent_shell',
      'terminal.env_passthrough',
      'file_read_max_chars'
    ]
  },
  {
    id: 'safety',
    label: 'Safety',
    icon: Lock,
    keys: [
      'approvals.mode',
      'approvals.timeout',
      'approvals.mcp_reload_confirm',
      'command_allowlist',
      'security.redact_secrets',
      'security.allow_private_urls',
      'browser.allow_private_urls',
      'browser.auto_local_for_private_urls',
      'checkpoints.enabled'
    ]
  },
  {
    id: 'memory',
    label: 'Memory & Context',
    icon: Brain,
    keys: [
      'memory.memory_enabled',
      'memory.user_profile_enabled',
      'memory.memory_char_limit',
      'memory.user_char_limit',
      'memory.provider',
      'context.engine',
      'compression.enabled',
      'compression.threshold',
      'compression.target_ratio',
      'compression.protect_last_n'
    ]
  },
  {
    id: 'voice',
    label: 'Voice',
    icon: Mic,
    keys: [
      'tts.provider',
      'stt.enabled',
      'stt.provider',
      'voice.auto_tts',
      'tts.edge.voice',
      'tts.openai.model',
      'tts.openai.voice',
      'tts.elevenlabs.voice_id',
      'tts.elevenlabs.model_id',
      'stt.local.model',
      'stt.local.language',
      'stt.elevenlabs.model_id',
      'stt.elevenlabs.language_code',
      'stt.elevenlabs.tag_audio_events',
      'stt.elevenlabs.diarize',
      'voice.record_key',
      'voice.max_recording_seconds'
    ]
  },
  {
    id: 'advanced',
    label: 'Advanced',
    icon: Wrench,
    keys: [
      'toolsets',
      'terminal.backend',
      'terminal.timeout',
      'tool_output.max_bytes',
      'tool_output.max_lines',
      'tool_output.max_line_length',
      'checkpoints.max_snapshots',
      'agent.max_turns',
      'agent.api_max_retries',
      'agent.service_tier',
      'agent.tool_use_enforcement',
      'delegation.model',
      'delegation.provider',
      'delegation.max_iterations',
      'delegation.max_concurrent_children',
      'delegation.child_timeout_seconds',
      'delegation.reasoning_effort'
    ]
  }
]

export interface ModeOption {
  id: ThemeMode
  label: string
  icon: IconComponent
}

export const MODE_OPTIONS: ModeOption[] = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'system', label: 'System', icon: Monitor }
]

const FIELD_LABELS_ZH: Record<string, string> = {
  model: '默认模型',
  model_context_length: '上下文窗口',
  fallback_providers: '备用模型',
  toolsets: '启用工具集',
  timezone: '时区',
  'display.personality': '助手风格',
  'display.show_reasoning': '推理区块',
  'agent.max_turns': '最大 Agent 步数',
  'agent.image_input_mode': '图片附件',
  'terminal.cwd': '工作目录',
  'terminal.backend': '执行后端',
  'terminal.timeout': '命令超时',
  'terminal.persistent_shell': '持久 Shell',
  'terminal.env_passthrough': '环境变量透传',
  file_read_max_chars: '文件读取上限',
  'tool_output.max_bytes': '终端输出上限',
  'tool_output.max_lines': '文件分页上限',
  'tool_output.max_line_length': '行长度上限',
  'code_execution.mode': '代码执行模式',
  'approvals.mode': '审批模式',
  'approvals.timeout': '审批超时',
  'approvals.mcp_reload_confirm': '确认 MCP 重载',
  command_allowlist: '命令白名单',
  'security.redact_secrets': '隐藏密钥',
  'security.allow_private_urls': '允许私有 URL',
  'browser.allow_private_urls': '浏览器私有 URL',
  'browser.auto_local_for_private_urls': '私有 URL 使用本地浏览器',
  'checkpoints.enabled': '文件检查点',
  'checkpoints.max_snapshots': '检查点数量上限',
  'voice.record_key': '语音快捷键',
  'voice.max_recording_seconds': '最大录音时长',
  'voice.auto_tts': '自动朗读回复',
  'stt.enabled': '语音转文字',
  'stt.provider': '语音识别服务',
  'stt.local.model': '本地转写模型',
  'stt.local.language': '转写语言',
  'stt.elevenlabs.model_id': 'ElevenLabs STT 模型',
  'stt.elevenlabs.language_code': 'ElevenLabs 语言',
  'stt.elevenlabs.tag_audio_events': '标注音频事件',
  'stt.elevenlabs.diarize': '说话人分离',
  'tts.provider': '文字转语音服务',
  'tts.edge.voice': 'Edge 声音',
  'tts.openai.model': 'OpenAI TTS 模型',
  'tts.openai.voice': 'OpenAI 声音',
  'tts.elevenlabs.voice_id': 'ElevenLabs 声音',
  'tts.elevenlabs.model_id': 'ElevenLabs 模型',
  'memory.memory_enabled': '持久记忆',
  'memory.user_profile_enabled': '用户画像',
  'memory.memory_char_limit': '记忆预算',
  'memory.user_char_limit': '画像预算',
  'memory.provider': '记忆服务',
  'context.engine': '上下文引擎',
  'compression.enabled': '自动压缩',
  'compression.threshold': '压缩阈值',
  'compression.target_ratio': '压缩目标比例',
  'compression.protect_last_n': '保护最近消息',
  'agent.api_max_retries': 'API 重试次数',
  'agent.service_tier': '服务等级',
  'agent.tool_use_enforcement': '工具使用约束',
  'delegation.model': '子 Agent 模型',
  'delegation.provider': '子 Agent 服务商',
  'delegation.max_iterations': '子 Agent 轮次上限',
  'delegation.max_concurrent_children': '并行子 Agent',
  'delegation.child_timeout_seconds': '子 Agent 超时',
  'delegation.reasoning_effort': '子 Agent 推理强度'
}

const FIELD_DESCRIPTIONS_ZH: Record<string, string> = {
  model: '新对话默认使用的模型，除非你在输入区另行选择。',
  model_context_length: '填 0 时使用所选模型自动检测到的上下文窗口。',
  fallback_providers: '默认模型失败时依次尝试的 provider:model 备用项。',
  'display.personality': '新会话默认使用的助手表达风格。',
  timezone: 'Hermes 需要本地时间上下文时使用；留空则使用系统时区。',
  'display.show_reasoning': '后端提供推理内容时在界面中显示推理区块。',
  'agent.image_input_mode': '控制图片附件如何发送给模型。',
  'terminal.cwd': '工具和终端操作默认使用的项目目录。',
  'code_execution.mode': '控制代码执行在当前项目中的作用域严格程度。',
  'terminal.persistent_shell': '后端支持时，在命令之间保留 Shell 状态。',
  'terminal.env_passthrough': '传入工具执行环境的环境变量。',
  file_read_max_chars: 'Hermes 单次文件读取允许读取的最大字符数。',
  'approvals.mode': 'Hermes 如何处理需要明确审批的命令。',
  'approvals.timeout': '审批提示等待响应的时间。',
  'security.redact_secrets': '尽可能从模型可见内容中隐藏检测到的密钥。',
  'checkpoints.enabled': '文件编辑前创建可回滚快照。',
  'memory.memory_enabled': '保存可帮助未来会话的持久记忆。',
  'memory.user_profile_enabled': '维护一份紧凑的用户偏好画像。',
  'context.engine': '长对话接近上下文上限时的管理策略。',
  'compression.enabled': '对话变大时压缩较早上下文。',
  'voice.auto_tts': '自动朗读助手回复。',
  'stt.enabled': '启用本地或服务商提供的语音转写。',
  'stt.elevenlabs.language_code': '可选 ISO-639-3 语言代码；留空则让 ElevenLabs 自动检测。',
  'agent.max_turns': 'Hermes 停止一次运行前允许的工具调用轮次上限。'
}

const SECTION_LABELS_ZH: Record<DesktopConfigSection['id'], string> = {
  advanced: '高级',
  appearance: '外观',
  chat: '对话',
  memory: '记忆与上下文',
  model: '模型',
  safety: '安全',
  voice: '语音',
  workspace: '工作区'
}

export function fieldLabelsFor(language: AppLanguage): Record<string, string> {
  return language === 'zh' ? { ...FIELD_LABELS, ...FIELD_LABELS_ZH } : FIELD_LABELS
}

export function fieldDescriptionsFor(language: AppLanguage): Record<string, string> {
  return language === 'zh' ? { ...FIELD_DESCRIPTIONS, ...FIELD_DESCRIPTIONS_ZH } : FIELD_DESCRIPTIONS
}

export function sectionsFor(language: AppLanguage): DesktopConfigSection[] {
  if (language !== 'zh') {
    return SECTIONS
  }

  return SECTIONS.map(section => ({
    ...section,
    label: SECTION_LABELS_ZH[section.id] ?? section.label
  }))
}

export function modeOptionsFor(language: AppLanguage): ModeOption[] {
  if (language !== 'zh') {
    return MODE_OPTIONS
  }

  return [
    { id: 'light', label: '浅色', icon: Sun },
    { id: 'dark', label: '深色', icon: Moon },
    { id: 'system', label: '跟随系统', icon: Monitor }
  ]
}
