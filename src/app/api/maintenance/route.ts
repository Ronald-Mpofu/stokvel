import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma/client'

const maintenanceSchema = z.object({
  assetId:        z.string().uuid(),
  type:           z.string(),
  description:    z.string().min(1),
  performedBy:    z.string().optional(),
  vendor:         z.string().optional(),
  cost:           z.coerce.number().min(0),
  scheduledDate:  z.string().optional(),
  completedDate:  z.string().optional(),
  nextDueDate:    z.string().optional(),
  nextDueMileage: z.coerce.number().optional(),
  mileageAtService: z.coerce.number().optional(),
  status:         z.string().default('SCHEDULED'),
  invoiceUrl:     z.string().optional(),
  notes:          z.string().optional(),
})

const depreciationSchema = z.object({
  assetId:        z.string().uuid(),
  method:         z.string().default('STRAIGHT_LINE'),
  usefulLifeYears: z.coerce.number().min(1).default(5),
  residualValue:  z.coerce.number().min(0).default(0),
  acquisitionCost: z.coerce.number().positive(),
})

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const assetId = searchParams.get('assetId')
    if (!assetId) return NextResponse.json({ success:false, error:'assetId required' }, { status:400 })

    const [records, depreciation, asset] = await Promise.all([
      prisma.assetMaintenance.findMany({ where:{ assetId }, orderBy:{ scheduledDate:'desc' } }),
      prisma.assetDepreciation.findUnique({ where:{ assetId } }),
      prisma.asset.findUnique({ where:{ id:assetId }, select:{ acquisitionCost:true, acquiredAt:true, currentValue:true } }),
    ])

    const now = new Date()
    const overdue  = records.filter(r => r.status === 'SCHEDULED' && r.scheduledDate && new Date(r.scheduledDate) < now)
    const upcoming = records.filter(r => r.status === 'SCHEDULED' && r.scheduledDate && new Date(r.scheduledDate) >= now)
    const totalCost = records.filter(r => r.status === 'COMPLETED').reduce((s,r) => s + Number(r.cost), 0)

    // Calculate current depreciated value if depreciation exists
    let currentDepreciatedValue = null
    if (depreciation && asset?.acquiredAt) {
      const yearsOwned = (now.getTime() - new Date(asset.acquiredAt).getTime()) / (1000 * 60 * 60 * 24 * 365)
      const annualDep  = (Number(depreciation.acquisitionCost) - Number(depreciation.residualValue)) / depreciation.usefulLifeYears
      currentDepreciatedValue = Math.max(Number(depreciation.residualValue), Number(depreciation.acquisitionCost) - annualDep * yearsOwned)
    }

    return NextResponse.json({
      success: true,
      data: {
        records: records.map(r => ({
          id:               r.id,
          type:             r.type,
          description:      r.description,
          performedBy:      r.performedBy,
          vendor:           r.vendor,
          cost:             Number(r.cost),
          scheduledDate:    r.scheduledDate,
          completedDate:    r.completedDate,
          nextDueDate:      r.nextDueDate,
          nextDueMileage:   r.nextDueMileage,
          mileageAtService: r.mileageAtService,
          status:           r.status,
          invoiceUrl:       r.invoiceUrl,
          notes:            r.notes,
          isOverdue:        r.status === 'SCHEDULED' && r.scheduledDate ? new Date(r.scheduledDate) < now : false,
          createdAt:        r.createdAt,
        })),
        depreciation: depreciation ? {
          method:              depreciation.method,
          usefulLifeYears:     depreciation.usefulLifeYears,
          residualValue:       Number(depreciation.residualValue),
          acquisitionCost:     Number(depreciation.acquisitionCost),
          currentValue:        Number(depreciation.currentValue),
          depreciationRate:    Number(depreciation.depreciationRate),
          currentDepreciatedValue,
          lastCalculatedAt:    depreciation.lastCalculatedAt,
        } : null,
        summary: { totalRecords:records.length, overdue:overdue.length, upcoming:upcoming.length, totalMaintenanceCost:totalCost },
      },
    })
  } catch (e: any) {
    return NextResponse.json({ success:false, error:e.message }, { status:500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    if (body.action === 'SET_DEPRECIATION') {
      const data = depreciationSchema.parse(body)
      const annualDep  = (data.acquisitionCost - data.residualValue) / data.usefulLifeYears
      const rate       = data.method === 'STRAIGHT_LINE' ? (1 / data.usefulLifeYears) * 100 : 40

      const dep = await prisma.assetDepreciation.upsert({
        where:  { assetId: data.assetId },
        create: { assetId:data.assetId, method:data.method, usefulLifeYears:data.usefulLifeYears, residualValue:data.residualValue, acquisitionCost:data.acquisitionCost, currentValue:data.acquisitionCost, depreciationRate:rate },
        update: { method:data.method, usefulLifeYears:data.usefulLifeYears, residualValue:data.residualValue, acquisitionCost:data.acquisitionCost, currentValue:data.acquisitionCost, depreciationRate:rate, lastCalculatedAt:new Date() },
      })
      return NextResponse.json({ success:true, data:{ id:dep.assetId }, message:'Depreciation schedule set' })
    }

    if (body.action === 'COMPLETE') {
      const { recordId, completedDate, cost, notes, invoiceUrl, nextDueDate } = body
      await prisma.assetMaintenance.update({
        where: { id:recordId },
        data:  { status:'COMPLETED', completedDate:completedDate ? new Date(completedDate) : new Date(), cost:cost||undefined, notes:notes||undefined, invoiceUrl:invoiceUrl||undefined, nextDueDate:nextDueDate?new Date(nextDueDate):undefined },
      })
      return NextResponse.json({ success:true, message:'Maintenance marked as completed' })
    }

    const data = maintenanceSchema.parse(body)
    const record = await prisma.assetMaintenance.create({
      data: {
        assetId:          data.assetId,
        type:             data.type,
        description:      data.description,
        performedBy:      data.performedBy,
        vendor:           data.vendor,
        cost:             data.cost,
        currency:         'USD' as any,
        scheduledDate:    data.scheduledDate ? new Date(data.scheduledDate) : undefined,
        completedDate:    data.completedDate ? new Date(data.completedDate) : undefined,
        nextDueDate:      data.nextDueDate   ? new Date(data.nextDueDate)   : undefined,
        nextDueMileage:   data.nextDueMileage,
        mileageAtService: data.mileageAtService,
        status:           data.status,
        invoiceUrl:       data.invoiceUrl,
        notes:            data.notes,
      },
    })
    return NextResponse.json({ success:true, data:{ id:record.id }, message:`${data.type} record created` }, { status:201 })
  } catch (e: any) {
    if (e instanceof z.ZodError) return NextResponse.json({ success:false, error:e.errors.map((x:any)=>x.message).join('; ') }, { status:400 })
    return NextResponse.json({ success:false, error:e.message }, { status:500 })
  }
}
