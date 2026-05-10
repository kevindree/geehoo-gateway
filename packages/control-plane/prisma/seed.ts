import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  const email = (process.env.BOOTSTRAP_ADMIN_EMAIL ?? '').trim().toLowerCase()
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD

  if (!email) {
    console.log('BOOTSTRAP_ADMIN_EMAIL not set — skipping super-admin seed.')
    return
  }
  if (!password || password.length < 12) {
    console.error('ERROR: Set BOOTSTRAP_ADMIN_PASSWORD env var (min 12 chars) before seeding.')
    process.exit(1)
  }

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    console.log(`Super admin "${email}" already exists. Skipping.`)
    return
  }

  const passwordHash = await bcrypt.hash(password, 12)
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      systemRole: 'SUPER_ADMIN',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  })

  console.log(`Created SUPER_ADMIN user: ${user.email} (id: ${user.id})`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
