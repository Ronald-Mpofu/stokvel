// src/app/api/assets/handover/route.ts
// Generates a Digital Handover Certificate PDF for a delivered Round Robin asset

import { NextRequest, NextResponse } from 'next/server'
import { PDFDocument, rgb, StandardFonts, PageSizes } from 'pdf-lib'
import prisma from '@/lib/prisma/client'

// ── Colour palette ────────────────────────────────────────────
const TEAL   = rgb(0.059, 0.431, 0.337)   // #0F6E56
const NAVY   = rgb(0.051, 0.129, 0.216)   // #0D2137
const PURPLE = rgb(0.486, 0.231, 0.929)   // #7C3AED
const WHITE  = rgb(1, 1, 1)
const LGRAY  = rgb(0.949, 0.957, 0.965)   // #F1F5F9
const MGRAY  = rgb(0.392, 0.447, 0.557)   // #64748B
const DGRAY  = rgb(0.118, 0.161, 0.235)   // #1E293B
const GREEN  = rgb(0.086, 0.396, 0.204)   // #166534
const GBORDER= rgb(0.529, 0.937, 0.604)   // #86EFAC

// ── Helper: draw text safely (replaces unsupported chars) ─────
function safe(text: string | null | undefined): string {
  if (!text) return '—'
  return String(text).replace(/[^\x00-\x7F]/g, '?')
}

// ── Helper: wrap long text ─────────────────────────────────────
function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    if ((current + ' ' + word).trim().length > maxChars) {
      if (current) lines.push(current.trim())
      current = word
    } else {
      current = (current + ' ' + word).trim()
    }
  }
  if (current) lines.push(current.trim())
  return lines
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const entryId = searchParams.get('entryId')
    const preview = searchParams.get('preview') === 'true'

    if (!entryId) {
      return NextResponse.json({ success: false, error: 'entryId required' }, { status: 400 })
    }

    // ── Fetch all data ──────────────────────────────────────────
    const entry = await prisma.assetQueueEntry.findUnique({
      where: { id: entryId },
      include: {
        user:  { select: { fullName: true, email: true, phone: true, nationalIdHash: true, city: true, country: true } },
        asset: {
          include: {
            group: { select: { name: true, country: true, region: true, admin: { select: { fullName: true, email: true } } } },
          },
        },
      },
    })

    if (!entry) return NextResponse.json({ success: false, error: 'Queue entry not found' }, { status: 404 })
    if (!['DELIVERED','ORDERED'].includes(entry.status) && !preview) {
      return NextResponse.json({ success: false, error: 'Certificate only available for delivered or ordered items' }, { status: 400 })
    }

    const asset  = entry.asset
    const group  = asset.group
    const member = entry.user
    const now    = new Date()

    const deliveryDate = entry.deliveredAt
      ? new Date(entry.deliveredAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
      : now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

    const issueDate = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    const certRef   = `HOC-${asset.id.slice(0,6).toUpperCase()}-${entry.position.toString().padStart(3,'0')}-${now.getFullYear()}`

    // ── Build PDF ───────────────────────────────────────────────
    const doc  = await PDFDocument.create()
    const page = doc.addPage(PageSizes.A4)
    const { width, height } = page.getSize()
    const W = width, H = height

    const fontRegular = await doc.embedFont(StandardFonts.Helvetica)
    const fontBold    = await doc.embedFont(StandardFonts.HelveticaBold)
    const fontOblique = await doc.embedFont(StandardFonts.HelveticaOblique)

    // ── Background ──────────────────────────────────────────────
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: WHITE })

    // ── Top decorative band ─────────────────────────────────────
    page.drawRectangle({ x: 0, y: H - 72, width: W, height: 72, color: NAVY })
    // Teal accent stripe
    page.drawRectangle({ x: 0, y: H - 76, width: W, height: 4, color: TEAL })

    // ── Header text ─────────────────────────────────────────────
    page.drawText('STOKVEL PLATFORM', {
      x: 40, y: H - 30, size: 10, font: fontBold, color: rgb(0.624, 0.878, 0.792),
    })
    page.drawText('Digital Handover Certificate', {
      x: 40, y: H - 50, size: 18, font: fontBold, color: WHITE,
    })
    page.drawText(`Ref: ${certRef}`, {
      x: W - 200, y: H - 30, size: 8, font: fontRegular, color: rgb(0.624, 0.878, 0.792),
    })
    page.drawText(`Issued: ${issueDate}`, {
      x: W - 200, y: H - 46, size: 8, font: fontRegular, color: rgb(0.624, 0.878, 0.792),
    })
    // Status badge
    const statusLabel = preview ? 'PREVIEW' : 'OFFICIAL'
    const badgeBg = preview ? rgb(0.722, 0.290, 0.161) : TEAL
    page.drawRectangle({ x: W - 200, y: H - 68, width: 80, height: 18, color: badgeBg, borderRadius: 3 })
    page.drawText(statusLabel, { x: W - 190, y: H - 62, size: 8, font: fontBold, color: WHITE })

    // ── Certificate title block ─────────────────────────────────
    let y = H - 110
    page.drawText('ASSET DELIVERY & OWNERSHIP CERTIFICATE', {
      x: 40, y, size: 13, font: fontBold, color: NAVY,
    })
    y -= 16
    page.drawText('This certificate confirms the successful delivery and transfer of ownership of the asset described below.', {
      x: 40, y, size: 8, font: fontOblique, color: MGRAY,
    })

    // ── Horizontal divider ──────────────────────────────────────
    y -= 14
    page.drawLine({ start: { x: 40, y }, end: { x: W - 40, y }, thickness: 1, color: LGRAY })
    y -= 18

    // ── Section helper ──────────────────────────────────────────
    function sectionHeader(label: string) {
      page.drawRectangle({ x: 40, y: y - 2, width: W - 80, height: 20, color: NAVY })
      page.drawText(label.toUpperCase(), { x: 48, y: y + 3, size: 8, font: fontBold, color: WHITE })
      y -= 24
    }

    function fieldRow(label: string, value: string, col2label?: string, col2value?: string) {
      const colW = col2label ? (W - 80) / 2 - 8 : W - 80
      // Label
      page.drawText(safe(label) + ':', { x: 48, y, size: 8, font: fontBold, color: MGRAY })
      // Value
      const lines = wrapText(safe(value), col2label ? 40 : 80)
      page.drawText(safe(lines[0]), { x: 160, y, size: 9, font: fontRegular, color: DGRAY })
      if (lines[1]) { y -= 12; page.drawText(safe(lines[1]), { x: 160, y, size: 9, font: fontRegular, color: DGRAY }) }

      if (col2label && col2value) {
        const cx = 40 + colW + 16
        page.drawText(safe(col2label) + ':', { x: cx, y, size: 8, font: fontBold, color: MGRAY })
        page.drawText(safe(col2value), { x: cx + 112, y, size: 9, font: fontRegular, color: DGRAY })
      }
      y -= 14
    }

    function shadeRow(label: string, value: string, highlight = false) {
      page.drawRectangle({ x: 40, y: y - 4, width: W - 80, height: 16, color: highlight ? rgb(0.878, 0.961, 0.898) : LGRAY })
      page.drawText(safe(label), { x: 48, y, size: 8, font: fontBold, color: highlight ? GREEN : MGRAY })
      page.drawText(safe(value), { x: 260, y, size: 9, font: highlight ? fontBold : fontRegular, color: highlight ? GREEN : DGRAY })
      y -= 18
    }

    // ── 1. Member Details ───────────────────────────────────────
    sectionHeader('1.  Recipient Member Details')
    fieldRow('Full Name',    member.fullName,          'Queue Position', `#${entry.position} of ${asset.unitsTotal}`)
    fieldRow('Email',        member.email,             'Phone',          member.phone || '—')
    fieldRow('City / Region', member.city || '—',     'Country',        member.country || '—')
    fieldRow('Group',        group.name,               'Group Region',   `${group.region || '—'}, ${group.country || '—'}`)
    y -= 6

    // ── 2. Asset Details ────────────────────────────────────────
    sectionHeader('2.  Asset Description')
    fieldRow('Asset Name',   asset.name,               'Asset Type',     safe(asset.type).replace(/_/g,' '))
    fieldRow('Make / Brand', asset.make || '—',        'Model',          asset.model || '—')
    fieldRow('Year',         asset.year ? String(asset.year) : '—', 'Serial Number', entry.serialNumber || '—')
    fieldRow('Location',     asset.location || '—',   'Campaign Type',  'Round Robin Asset')
    if (asset.notes) fieldRow('Asset Notes', asset.notes)
    y -= 6

    // ── 3. Financial Summary ────────────────────────────────────
    sectionHeader('3.  Financial Summary')
    const unitCost = Number(asset.unitCost || 0)
    const raised   = Number(entry.raisedAmount)
    shadeRow('Unit Target Amount',         `$${unitCost.toLocaleString('en-US',{minimumFractionDigits:2})}`)
    shadeRow('Total Contributed by Member', `$${raised.toLocaleString('en-US',{minimumFractionDigits:2})}`)
    shadeRow('Outstanding Balance',         raised >= unitCost ? 'NIL — Fully Paid' : `$${(unitCost-raised).toLocaleString('en-US',{minimumFractionDigits:2})}`, raised >= unitCost)
    shadeRow('Ownership',                   '100% — Full individual ownership of this unit', true)
    y -= 6

    // ── 4. Delivery Record ──────────────────────────────────────
    sectionHeader('4.  Delivery Record')
    fieldRow('Delivery Date',  deliveryDate,           'Status',         preview ? 'PREVIEW' : 'DELIVERED ✓')
    fieldRow('Serial Number',  entry.serialNumber || 'To be assigned', 'Asset Condition', 'As specified in delivery notes')
    if (entry.deliveryNotes) {
      page.drawText('Delivery Notes:', { x: 48, y, size: 8, font: fontBold, color: MGRAY })
      y -= 2
      const noteLines = wrapText(entry.deliveryNotes, 90)
      for (const line of noteLines.slice(0, 4)) {
        y -= 12
        page.drawText(safe(line), { x: 48, y, size: 8, font: fontRegular, color: DGRAY })
      }
      y -= 6
    }
    y -= 6

    // ── 5. Terms & Conditions ───────────────────────────────────
    sectionHeader('5.  Terms & Conditions')
    const terms = [
      '1. This certificate confirms transfer of ownership of the specific unit described above to the named recipient.',
      '2. The recipient assumes full responsibility for the asset from the delivery date stated above.',
      '3. The asset is transferred as part of the Round Robin Asset Programme managed by the Stokvel Platform.',
      '4. Any income generated by this asset after the delivery date belongs solely to the recipient.',
      '5. The recipient is responsible for insuring and maintaining the asset from the delivery date.',
      '6. This certificate serves as the official record of ownership transfer and should be retained safely.',
    ]
    for (const term of terms) {
      const termLines = wrapText(term, 95)
      for (const tl of termLines) {
        page.drawText(safe(tl), { x: 48, y, size: 7.5, font: fontRegular, color: MGRAY })
        y -= 11
      }
    }
    y -= 10

    // ── 6. Signatures ───────────────────────────────────────────
    if (y > 120) {
      page.drawLine({ start: { x: 40, y }, end: { x: W - 40, y }, thickness: 0.5, color: LGRAY })
      y -= 18
      page.drawText('SIGNATURES', { x: 40, y, size: 8, font: fontBold, color: NAVY })
      y -= 18

      const sigColW = (W - 80) / 3 - 10
      const cols    = [40, 40 + sigColW + 15, 40 + (sigColW + 15) * 2]
      const sigLabels = ['Recipient', 'Group Administrator', 'Platform Witness']
      const sigNames  = [member.fullName, group.admin.fullName, 'Stokvel Platform']

      for (let i = 0; i < 3; i++) {
        const cx = cols[i]
        // Signature box
        page.drawRectangle({ x: cx, y: y - 36, width: sigColW, height: 36, color: LGRAY })
        page.drawText('Sign here', { x: cx + sigColW/2 - 20, y: y - 22, size: 7, font: fontOblique, color: rgb(0.7,0.7,0.7) })
        y -= 42
        page.drawLine({ start: { x: cx, y }, end: { x: cx + sigColW, y }, thickness: 0.5, color: rgb(0.6,0.6,0.6) })
        page.drawText(safe(sigLabels[i]), { x: cx, y: y - 12, size: 7, font: fontBold, color: MGRAY })
        page.drawText(safe(sigNames[i]),  { x: cx, y: y - 22, size: 7.5, font: fontRegular, color: DGRAY })
        page.drawText('Date: _______________', { x: cx, y: y - 34, size: 7, font: fontRegular, color: MGRAY })
        y += 42
      }
      y -= 60
    }

    // ── Footer ──────────────────────────────────────────────────
    page.drawRectangle({ x: 0, y: 0, width: W, height: 36, color: NAVY })
    page.drawText(`Certificate Reference: ${certRef}`, {
      x: 40, y: 22, size: 7.5, font: fontBold, color: rgb(0.624, 0.878, 0.792),
    })
    page.drawText('Generated by Stokvel Platform  |  This is an official document. Retain for your records.', {
      x: 40, y: 10, size: 7, font: fontRegular, color: rgb(0.5, 0.6, 0.7),
    })
    page.drawText(issueDate, {
      x: W - 120, y: 16, size: 7, font: fontRegular, color: rgb(0.5, 0.6, 0.7),
    })

    // ── Left accent bar ─────────────────────────────────────────
    page.drawRectangle({ x: 0, y: 36, width: 4, height: H - 108, color: TEAL })

    // ── Watermark for preview ───────────────────────────────────
    if (preview) {
      page.drawText('PREVIEW', {
        x: 120, y: H / 2 - 40, size: 80, font: fontBold,
        color: rgb(0.9, 0.9, 0.9), opacity: 0.25, rotate: { angle: 35, type: 'degrees' as any },
      })
    }

    // ── Serialise ───────────────────────────────────────────────
    const pdfBytes = await doc.save()

    // ── Audit log ───────────────────────────────────────────────
    if (!preview) {
      await prisma.auditLog.create({
        data: {
          action:      'EXPORT',
          entityType:  'AssetQueueEntry',
          entityId:    entryId,
          description: `Handover certificate generated. Ref: ${certRef}. Member: ${member.fullName}`,
        },
      }).catch(() => {}) // Non-blocking
    }

    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `${preview ? 'inline' : 'attachment'}; filename="Handover-Certificate-${certRef}.pdf"`,
        'Content-Length':      String(pdfBytes.byteLength),
        'Cache-Control':       'no-store',
      },
    })
  } catch (error: any) {
    console.error('Handover certificate error:', error)
    return NextResponse.json({ success: false, error: error.message || 'Failed to generate certificate' }, { status: 500 })
  }
}
