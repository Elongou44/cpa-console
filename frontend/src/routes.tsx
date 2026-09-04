import { Outlet, createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router'
import { AppShell } from '@/components/layout/app-shell'
import AccountsPage from '@/features/accounts'
import AliasesPage from '@/features/aliases'
import ModelsPage from '@/features/models'
import SettingsPage from '@/features/settings'

const rootRoute = createRootRoute({
  component: () => <AppShell />,
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/accounts' })
  },
})

const accountsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/accounts',
  component: AccountsPage,
})

const modelsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/models',
  component: ModelsPage,
})

const aliasesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/aliases',
  component: AliasesPage,
})

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsPage,
})

const routeTree = rootRoute.addChildren([indexRoute, accountsRoute, aliasesRoute, modelsRoute, settingsRoute])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
