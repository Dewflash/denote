// src/app/RightPanel.tsx — shell right panel: Backlinks / Outgoing links tabs (D16 Radix).

import * as Tabs from '@radix-ui/react-tabs';
import { useUiStore, type RightPanelTab } from '../state/uiStore';
import { BacklinksPanel } from '../features/editor/BacklinksPanel';
import { OutgoingLinksPanel } from '../features/editor/OutgoingLinksPanel';

export function RightPanel() {
  const tab = useUiStore((s) => s.rightPanelTab);
  const setTab = useUiStore((s) => s.setRightPanelTab);

  return (
    <Tabs.Root
      value={tab}
      onValueChange={(v) => setTab(v as RightPanelTab)}
      className="flex h-full flex-col"
    >
      <Tabs.List className="flex" style={{ borderBottom: '1px solid var(--border)' }}>
        <Tabs.Trigger value="backlinks" className="denote-tab-trigger flex-1 px-3 py-2 text-sm">
          Backlinks
        </Tabs.Trigger>
        <Tabs.Trigger value="outgoing" className="denote-tab-trigger flex-1 px-3 py-2 text-sm">
          Outgoing links
        </Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="backlinks" className="flex-1 overflow-auto">
        <BacklinksPanel />
      </Tabs.Content>
      <Tabs.Content value="outgoing" className="flex-1 overflow-auto">
        <OutgoingLinksPanel />
      </Tabs.Content>
    </Tabs.Root>
  );
}
