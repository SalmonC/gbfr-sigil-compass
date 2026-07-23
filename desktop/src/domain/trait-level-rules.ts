export interface ExternalTraitLevelRule {
  readonly shortLabel: string;
  readonly explanation: string;
}

const externalTraitLevelRules = new Map<string, ExternalTraitLevelRule>([
  ['SKILL_140_00', {
    shortLabel: '收集进度决定',
    explanation: '钳蟹的共鸣按已收集的小钳蟹数量生效，强化因子不会把它提高到卡片中曾显示的 45 级。'
  }],
  ['SKILL_141_00', {
    shortLabel: '收集进度决定',
    explanation: '钳蟹的报恩按已收集的小钳蟹数量生效，技能效果不由这枚因子的等级单独决定。'
  }],
  ['SKILL_164_00', {
    shortLabel: '收集进度决定',
    explanation: '终极钳蟹因子按已收集的小钳蟹数量生效，技能效果不由这枚因子的等级单独决定。'
  }]
]);

export function externalTraitLevelRule(traitId: string | undefined): ExternalTraitLevelRule | undefined {
  return traitId ? externalTraitLevelRules.get(traitId) : undefined;
}
