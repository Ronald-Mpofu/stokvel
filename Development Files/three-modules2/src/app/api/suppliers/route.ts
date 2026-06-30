import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma/client'

const supplierSchema = z.object({
  name:          z.string().min(2),
  tradingName:   z.string().optional(),
  country:       z.string().min(1),
  city:          z.string().optional(),
  address:       z.string().optional(),
  phone:         z.string().optional(),
  email:         z.string().email().optional().or(z.literal('')),
  website:       z.string().optional(),
  contactPerson: z.string().optional(),
  contactPhone:  z.string().optional(),
  contactEmail:  z.string().optional(),
  category:      z.string(),
  paymentTerms:  z.string().optional(),
  leadTimeDays:  z.coerce.number().optional(),
  rating:        z.coerce.number().min(1).max(5).optional(),
  taxNumber:     z.string().optional(),
  notes:         z.string().optional(),
})

const quoteSchema = z.object({
  supplierId:       z.string().uuid(),
  assetId:          z.string().uuid().optional(),
  title:            z.string().min(1),
  description:      z.string().optional(),
  currency:         z.string().default('USD'),
  unitPrice:        z.coerce.number().positive(),
  quantity:         z.coerce.number().min(1).default(1),
  incoterms:        z.string().optional(),
  validUntil:       z.string().optional(),
  leadTimeDays:     z.coerce.number().optional(),
  paymentTerms:     z.string().optional(),
  includesFreight:  z.boolean().default(false),
  includesInstall:  z.boolean().default(false),
  documentUrl:      z.string().optional(),
  notes:            z.string().optional(),
})

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const category = searchParams.get('category')
    const assetId  = searchParams.get('assetId')
    const search   = searchParams.get('search')

    const where: any = { status:'ACTIVE' }
    if (category) where.category = category
    if (search)   where.OR = [
      { name:      { contains: search, mode:'insensitive' } },
      { country:   { contains: search, mode:'insensitive' } },
      { category:  { contains: search, mode:'insensitive' } },
    ]

    const suppliers = await prisma.supplier.findMany({
      where,
      include: {
        quotes: {
          where: assetId ? { assetId } : {},
          orderBy: { createdAt:'desc' },
          take: 5,
        },
        _count: { select: { quotes:true } },
      },
      orderBy: [{ isVerified:'desc' }, { rating:'desc' }, { name:'asc' }],
    })

    return NextResponse.json({
      success: true,
      data: suppliers.map(s => ({
        id:            s.id,
        name:          s.name,
        tradingName:   s.tradingName,
        country:       s.country,
        city:          s.city,
        phone:         s.phone,
        email:         s.email,
        website:       s.website,
        contactPerson: s.contactPerson,
        contactPhone:  s.contactPhone,
        contactEmail:  s.contactEmail,
        category:      s.category,
        paymentTerms:  s.paymentTerms,
        leadTimeDays:  s.leadTimeDays,
        rating:        s.rating,
        isVerified:    s.isVerified,
        taxNumber:     s.taxNumber,
        notes:         s.notes,
        status:        s.status,
        quoteCount:    s._count.quotes,
        recentQuotes:  s.quotes.map(q => ({
          id:         q.id,
          title:      q.title,
          unitPrice:  Number(q.unitPrice),
          totalPrice: Number(q.totalPrice),
          currency:   q.currency,
          status:     q.status,
          validUntil: q.validUntil,
          createdAt:  q.createdAt,
        })),
        createdAt: s.createdAt,
      })),
    })
  } catch (e: any) {
    return NextResponse.json({ success:false, error:e.message }, { status:500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    if (body.action === 'ADD_QUOTE') {
      const data = quoteSchema.parse(body)
      const totalPrice = data.unitPrice * data.quantity
      const quote = await prisma.supplierQuote.create({
        data: {
          supplierId:      data.supplierId,
          assetId:         data.assetId,
          title:           data.title,
          description:     data.description,
          currency:        data.currency as any,
          unitPrice:       data.unitPrice,
          quantity:        data.quantity,
          totalPrice,
          incoterms:       data.incoterms,
          validUntil:      data.validUntil ? new Date(data.validUntil) : undefined,
          leadTimeDays:    data.leadTimeDays,
          paymentTerms:    data.paymentTerms,
          includesFreight: data.includesFreight,
          includesInstall: data.includesInstall,
          documentUrl:     data.documentUrl,
          notes:           data.notes,
        },
      })
      return NextResponse.json({ success:true, data:{ id:quote.id, totalPrice }, message:'Quote added' }, { status:201 })
    }

    if (body.action === 'UPDATE_QUOTE_STATUS') {
      const { quoteId, status } = body
      await prisma.supplierQuote.update({ where:{ id:quoteId }, data:{ status } })
      return NextResponse.json({ success:true, message:`Quote ${status.toLowerCase()}` })
    }

    if (body.action === 'VERIFY') {
      await prisma.supplier.update({ where:{ id:body.supplierId }, data:{ isVerified:true, verifiedAt:new Date() } })
      return NextResponse.json({ success:true, message:'Supplier verified' })
    }

    const data = supplierSchema.parse(body)
    const supplier = await prisma.supplier.create({
      data: {
        name:          data.name,
        tradingName:   data.tradingName,
        country:       data.country,
        city:          data.city,
        address:       data.address,
        phone:         data.phone,
        email:         data.email || undefined,
        website:       data.website,
        contactPerson: data.contactPerson,
        contactPhone:  data.contactPhone,
        contactEmail:  data.contactEmail,
        category:      data.category,
        paymentTerms:  data.paymentTerms,
        leadTimeDays:  data.leadTimeDays,
        rating:        data.rating,
        taxNumber:     data.taxNumber,
        notes:         data.notes,
      },
    })
    return NextResponse.json({ success:true, data:{ id:supplier.id }, message:`${data.name} added to supplier directory` }, { status:201 })
  } catch (e: any) {
    if (e instanceof z.ZodError) return NextResponse.json({ success:false, error:e.errors.map((x:any)=>x.message).join('; ') }, { status:400 })
    return NextResponse.json({ success:false, error:e.message }, { status:500 })
  }
}
