import { NodeProps } from 'reactflow';
import { NodeResizer } from '@reactflow/node-resizer';
import '@reactflow/node-resizer/dist/style.css';

// Module-level ref updated by PFDCanvas on each render.
// This avoids calling usePFDStore inside the node component,
// which would cause ReactFlow to treat nodeTypes as a new object.
export const editModeRef = { current: false };

export function SectionGroupNode({ data, selected }: NodeProps) {
  const editMode = editModeRef.current;
  const color: string = '#1A2F44';
  const label: string = data.label || '';

  return (
    <>
      {/* Resize handles (edit mode + selected only) */}
      <NodeResizer
        isVisible={editMode && selected}
        minWidth={400}
        minHeight={200}
        color={color}
        handleStyle={{
          width: 10, height: 10, borderRadius: 3,
          background: color, border: '2px solid var(--bg-surface)',
        }}
        lineStyle={{
          borderColor: color, borderWidth: 1.5, borderStyle: 'dashed',
        }}
      />

      {/* Section background box */}
      <div style={{
        width: '100%',
        height: '100%',
        borderRadius: 10,
        border: `1.5px solid ${color}${selected && editMode ? 'cc' : '44'}`,
        background: `${color}06`,
        boxSizing: 'border-box',
        position: 'relative',
        boxShadow: selected && editMode
          ? `0 0 0 2px ${color}55, inset 0 0 40px ${color}08`
          : `inset 0 0 30px ${color}05`,
        transition: 'border-color 0.2s, box-shadow 0.2s',
        // In view mode: transparent to pointer events so nodes below are clickable
        pointerEvents: editMode ? 'all' : 'none',
      }}>
        {/* Section title badge */}
        <div style={{
          position: 'absolute',
          top: -1,
          left: 14,
          transform: 'translateY(-50%)',
          background: `linear-gradient(90deg, ${color}22, var(--bg-surface) 50%, ${color}22)`,
          border: `1px solid ${color}55`,
          borderRadius: 20,
          padding: '3px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          whiteSpace: 'nowrap',
          backdropFilter: 'blur(8px)',
          zIndex: 10,
          pointerEvents: 'none',
        }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%',
            background: color,
            boxShadow: `0 0 6px ${color}`,
            flexShrink: 0,
          }} />
          <span style={{
            fontSize: 11, fontWeight: 700, color,
            fontFamily: 'JetBrains Mono, monospace',
            letterSpacing: '0.3px',
          }}>
            {label}
          </span>
          {editMode && (
            <span style={{
              fontSize: 9, color: `${color}99`,
              padding: '1px 6px', borderRadius: 8,
              background: `${color}15`,
              fontWeight: 500,
            }}>
              drag to move
            </span>
          )}
        </div>

        {/* Edit mode: dot grid pattern */}
        {editMode && (
          <div style={{
            position: 'absolute', inset: 0, borderRadius: 8, overflow: 'hidden',
            backgroundImage: `radial-gradient(${color}18 1px, transparent 1px)`,
            backgroundSize: '20px 20px',
            pointerEvents: 'none',
          }} />
        )}

        {/* Resize hint (edit mode + selected) */}
        {editMode && selected && (
          <div style={{
            position: 'absolute', bottom: 6, right: 10,
            fontSize: 9, color: `${color}88`,
            fontFamily: 'JetBrains Mono',
            pointerEvents: 'none',
          }}>
            corner drag to resize
          </div>
        )}
      </div>
    </>
  );
}
