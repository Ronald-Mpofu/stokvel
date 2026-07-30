'use client'
// src/app/portal/PortalGroupView.tsx
//
// Level two and three of the member portal: a group's scheme list, and
// then one scheme's passbook.
//
// The portal's Overview tab lists the groups a member belongs to. Tapping
// one lands here. This component owns nothing except the switch between
// the scheme card list and a single passbook — the hub and the passbook
// shell are the same components the admin dashboard uses.
//
// WHY CARDS AND NOT TABS
//   Six scheme names will not fit in a tab strip at 360px. They truncate
//   to four characters, and "Asse…" tells a member nothing. Scrolling tabs
//   hide options off-screen, which is the sideways-scroll problem the
//   layout rules exist to prevent. A card also has somewhere to put the
//   member's standing — $450, due 5 Aug — which a tab label does not.
//
// WHY THE NON-ENROLLED SCHEMES STAY VISIBLE
//   Greyed rather than hidden, so the per-scheme assignment model is
//   visible to the member and they can ask to be added. Hiding them would
//   leave a member unable to discover that a grocery club exists in their
//   own group.
//
// The back button returns to the portal's group list. Local state, not a
// route, so the portal's loaded data and scroll position survive.

import { useState, useCallback } from 'react'
import MobileSchemeHub from '../dashboard/groups/MobileSchemeHub'
import type { HubScheme } from '../dashboard/groups/MobileSchemeHub'
import MobileSchemePassbook from '../dashboard/groups/MobileSchemePassbook'

type Props = {
  groupId: string
  groupName: string
  onBack: () => void
}

export default function PortalGroupView({ groupId, groupName, onBack }: Props) {
  const [openPassbook, setOpenPassbook] = useState<HubScheme | null>(null)
  const closePassbook = useCallback(() => setOpenPassbook(null), [])

  if (openPassbook) {
    return (
      <MobileSchemePassbook
        schemeId={openPassbook.id}
        schemeName={openPassbook.name}
        onBack={closePassbook}
        // A member does not open cycles, so no admin action is offered
        // here even when the same person holds GROUP_ADMIN elsewhere. The
        // portal is their member-facing space; cycle setup lives in the
        // dashboard.
        canManage={false}
      />
    )
  }

  return (
    <MobileSchemeHub
      groupId={groupId}
      onBack={onBack}
      onOpenScheme={setOpenPassbook}
      // Embedded: the portal already provides page chrome and its own
      // background, so the hub must not claim a full viewport height on
      // top of it.
      embedded
    />
  )
}
