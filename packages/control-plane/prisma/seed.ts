import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  const username = process.env.SEED_ADMIN_USERNAME ?? 'admin'
  const password = process.env.SEED_ADMIN_PASSWORD

  if (!password || password.length < 12) {
    console.error('ERROR: Set SEED_ADMIN_PASSWORD env var (min 12 chars) before seeding.')
    process.exit(1)
  }

  const existing = await prisma.adminUser.findUnique({ where: { username } })
  if (existing) {
    console.log(`Admin user "${username}" already exists. Skipping.`)
    return
  }

  const passwordHash = await bcrypt.hash(password, 12)
  const user = await prisma.adminUser.create({
    data: {
      username,
      passwordHash,
      role: 'SUPER_ADMIN',
    },
  })

  console.log(`Created SUPER_ADMIN user: ${user.username} (id: ${user.id})`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
