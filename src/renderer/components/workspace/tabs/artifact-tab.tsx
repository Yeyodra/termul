import { Layers } from '@/components/icons'
import { TabContextMenu } from '../tab-context-menu'
import { TabChrome } from './tab-chrome'
import type { TabInlineProps } from './types'

interface ArtifactTabInlineProps extends TabInlineProps {
  tab: { type: 'artifact'; id: string }
}

/** Artifact tab: always "live", so it carries no dirty marker. */
export function ArtifactTabInline({
  tab,
  isActive,
  isDragging,
  isDropTarget,
  dropPosition,
  onSelect,
  onClose,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  bulkMenu
}: ArtifactTabInlineProps): React.JSX.Element {
  return (
    <TabContextMenu kind={tab.type} onClose={onClose} {...bulkMenu}>
      <TabChrome
        isActive={isActive}
        isDragging={isDragging}
        isDropTarget={isDropTarget}
        dropPosition={dropPosition}
        onSelect={onSelect}
        onClose={onClose}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        icon={<Layers size={12} />}
        label="Artifact"
        dirty={false}
        pinClose={isActive}
      />
    </TabContextMenu>
  )
}
