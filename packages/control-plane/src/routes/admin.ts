import { Router } from 'express'
import { requireAdmin, requireSuperAdmin } from '../middleware/adminAuth'
import { projectsRouter } from './projects'
import { usersRouter } from './users'

export const adminRouter = Router()

adminRouter.use(requireAdmin)

adminRouter.use('/projects', projectsRouter)
adminRouter.use('/users', requireSuperAdmin, usersRouter)
