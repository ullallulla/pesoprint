import { type RouteConfig, index, route } from '@react-router/dev/routes';

export default [
    index('routes/home.tsx'),
    route('models', 'routes/models.tsx'),
    route('models/:slug', 'routes/product.tsx'),
    route('categories/:slug', 'routes/category.tsx'),
    route('admin', 'routes/admin.tsx'),
    // Resource routes: no UI, they return files.
    route('sitemap.xml', 'routes/sitemap.ts'),
    route('robots.txt', 'routes/robots.ts'),
    route('*', 'routes/not-found.tsx'),
] satisfies RouteConfig;
