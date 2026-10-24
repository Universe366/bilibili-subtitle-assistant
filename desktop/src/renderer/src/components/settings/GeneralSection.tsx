import type { AppSettings } from '../../../../shared/types';
import { AddressSearchGroup } from './AddressSearchGroup';
import { AppearanceGroup } from './AppearanceGroup';
import { EfficiencyGroup } from './EfficiencyGroup';
import { ReadingGroup } from './ReadingGroup';
import { SessionsGroup } from './SessionsGroup';

type GeneralSettings = AppSettings['general'];

interface GeneralSectionProps {
  value: GeneralSettings;
  onChange: (patch: Partial<GeneralSettings>) => void;
}

/** 通用设置的兼容入口：实际内容按「外观 / 标签页 / 搜索 / 阅读 / 效率」拆分。 */
export function GeneralSection({ value, onChange }: GeneralSectionProps) {
  return (
    <>
      <AppearanceGroup value={value} onChange={onChange} />
      <SessionsGroup value={value} onChange={onChange} />
      <AddressSearchGroup value={value} onChange={onChange} />
      <ReadingGroup value={value} onChange={onChange} />
      <EfficiencyGroup value={value} onChange={onChange} />
    </>
  );
}
