'use client';

import AvatarInstance from '../avatar/avatar-instance';
import type { AvatarInstanceState } from '../avatar/avatar-instance.types';
import type { Teammate } from '../llm';
import BuddyGroup from './BuddyGroup';
import {
  ANCHOR,
  AVATAR_SIZE,
  COLLAPSED_STRIDE,
  EXPANDED_STRIDE,
  HULL_PAD_BOTTOM,
  HULL_PAD_TOP,
  HULL_PAD_X,
  STACK_STRIDE,
} from './constants';
import { gradientFor, peekedGroupPos } from './geometry';
import type { Edge, Group } from './types';

type Magnet = { draggedId: string; targetId: string; targetType: 'buddy' | 'group' } | null;
type EdgeMagnet = { kind: 'buddy' | 'group'; id: string; edge: Edge } | null;

type Props = {
  buddies: AvatarInstanceState[];
  groups: Group[];
  peeked: Record<string, boolean>;
  expanded: Record<string, boolean>;
  peekedDock: Record<string, boolean>;
  magnet: Magnet;
  edgeMagnet: EdgeMagnet;
  bumpTicks: Record<string, number>;
  rotationEnabled: boolean;
  rotations: Record<string, number>;
  activeRotKeys: Record<string, boolean>;
  grabPivots: Record<string, { x: number; y: number }>;
  shimejiActions: Record<string, import('@/lib/avatar/types').ShimejiAction>;
  shimejiDirections: Record<string, -1 | 1>;
  llmOnboardingBuddyId: string | null;
  teammatesFor: (buddy: AvatarInstanceState) => Teammate[];
  updateBuddy: (id: string, next: AvatarInstanceState) => void;
  spawnBuddy: () => void;
  removeBuddy: (id: string) => void;
  onOpenChange: (id: string, open: boolean) => void;
  onWonderPauseChange: (id: string, paused: boolean) => void;
  onDragMove: (id: string, pos: { x: number; y: number }) => void;
  onDragEnd: (id: string, pos: { x: number; y: number }, moved: boolean) => void;
  onGroupTap: (gid: string) => void;
  restoreBuddy: (id: string) => void;
  restoreGroup: (gid: string) => void;
  peekDockBuddy: (id: string) => void;
  unpeekDockBuddy: (id: string) => void;
  peekDockGroup: (gid: string) => void;
  unpeekDockGroup: (gid: string) => void;
  onBuddyDragStart: (id: string, grab: { x: number; y: number }) => void;
  onGroupDragStartPhysics: (gid: string, grab: { x: number; y: number }) => void;
  onGroupDragMove: (gid: string, pos: { x: number; y: number }) => void;
  onGroupDragEnd: (gid: string, pos: { x: number; y: number }) => void;
  onOpenAppSettings: () => void;
  onDismissLlmOnboarding: (id: string) => void;
};

export default function DashboardStage(props: Props) {
  const {
    buddies,
    groups,
    peeked,
    expanded,
    peekedDock,
    magnet,
    edgeMagnet,
    bumpTicks,
    rotationEnabled,
    rotations,
    activeRotKeys,
    grabPivots,
    shimejiActions,
    shimejiDirections,
    llmOnboardingBuddyId,
  } = props;

  return (
    <>
      {groups.map((g) => {
        const dockPeeked = !!peekedDock[`group:${g.id}`];
        const stride = (g.minimized && !dockPeeked)
          ? STACK_STRIDE
          : (expanded[g.id] ? EXPANDED_STRIDE : COLLAPSED_STRIDE);
        const memberVariantIds = g.memberIds
          .map((mid) => buddies.find((b) => b.id === mid)?.variantId)
          .filter((v): v is string => !!v);
        if (memberVariantIds.length < 2) return null;
        const renderedGroupPos = (g.minimized && dockPeeked)
          ? peekedGroupPos(g.minimized.edge, memberVariantIds.length, g.lastFreePos, stride)
          : g.pos;
        return (
          <BuddyGroup
            key={g.id}
            groupId={g.id}
            pos={renderedGroupPos}
            memberCount={memberVariantIds.length}
            stride={stride}
            avatarSize={AVATAR_SIZE}
            padX={HULL_PAD_X}
            padTop={HULL_PAD_TOP}
            padBottom={HULL_PAD_BOTTOM}
            anchor={ANCHOR}
            visible={(!g.minimized && (!!peeked[g.id] || !!expanded[g.id])) || (!!g.minimized && dockPeeked)}
            magnetActive={magnet?.targetType === 'group' && magnet.targetId === g.id}
            edgeMagnetActive={edgeMagnet?.kind === 'group' && edgeMagnet.id === g.id}
            background={gradientFor(memberVariantIds)}
            expanded={!!expanded[g.id]}
            onGroupDragMove={props.onGroupDragMove}
            onGroupDragEnd={props.onGroupDragEnd}
            onGroupTap={props.onGroupTap}
            bumpTick={bumpTicks[`group:${g.id}`] ?? 0}
            rotation={rotationEnabled ? (rotations[`group:${g.id}`] ?? 0) : 0}
            rotationActive={rotationEnabled && !!activeRotKeys[`group:${g.id}`]}
            grabPivot={rotationEnabled ? grabPivots[`group:${g.id}`] : undefined}
            onDragStartPhysics={props.onGroupDragStartPhysics}
          />
        );
      })}

      {buddies.map((b) => {
        let magnetState: 'attractor' | 'target' | null = null;
        if (magnet) {
          if (magnet.draggedId === b.id) magnetState = 'attractor';
          else if (magnet.targetType === 'buddy' && magnet.targetId === b.id) magnetState = 'target';
        }
        return (
          <AvatarInstance
            key={b.id}
            state={b}
            anchor={ANCHOR}
            canRemove={buddies.length > 1}
            onChange={(next) => props.updateBuddy(b.id, next)}
            onSpawn={props.spawnBuddy}
            onRemove={() => props.removeBuddy(b.id)}
            onOpenChange={props.onOpenChange}
            onWonderPauseChange={props.onWonderPauseChange}
            onDragMove={props.onDragMove}
            onDragEnd={props.onDragEnd}
            magnetState={magnetState}
            edgeMagnet={edgeMagnet?.kind === 'buddy' && edgeMagnet.id === b.id ? edgeMagnet.edge : null}
            teammates={props.teammatesFor(b)}
            groupMemberIds={b.groupId ? groups.find((g) => g.id === b.groupId)?.memberIds : undefined}
            isGroupExpanded={!!(b.groupId && expanded[b.groupId])}
            isGroupMinimized={!!(b.groupId && groups.find((g) => g.id === b.groupId)?.minimized)}
            onGroupTap={props.onGroupTap}
            onRestore={() => props.restoreBuddy(b.id)}
            onGroupRestore={props.restoreGroup}
            dockPeeked={!!peekedDock[`buddy:${b.id}`]}
            groupDockPeeked={!!(b.groupId && peekedDock[`group:${b.groupId}`])}
            onDockPeek={() => props.peekDockBuddy(b.id)}
            onDockUnpeek={() => props.unpeekDockBuddy(b.id)}
            onGroupDockPeek={(gid) => props.peekDockGroup(gid)}
            onGroupDockUnpeek={(gid) => props.unpeekDockGroup(gid)}
            bumpTick={bumpTicks[`buddy:${b.id}`] ?? 0}
            groupBumpTick={b.groupId ? (bumpTicks[`group:${b.groupId}`] ?? 0) : 0}
            rotation={rotationEnabled ? (rotations[`buddy:${b.id}`] ?? 0) : 0}
            rotationActive={rotationEnabled && !!activeRotKeys[`buddy:${b.id}`]}
            grabPivot={rotationEnabled ? grabPivots[`buddy:${b.id}`] : undefined}
            onDragStart={props.onBuddyDragStart}
            onOpenAppSettings={props.onOpenAppSettings}
            shimejiAction={shimejiActions[b.id]}
            shimejiDirection={shimejiDirections[b.id]}
            showLlmOnboarding={llmOnboardingBuddyId === b.id}
            onDismissLlmOnboarding={() => props.onDismissLlmOnboarding(b.id)}
          />
        );
      })}
    </>
  );
}
