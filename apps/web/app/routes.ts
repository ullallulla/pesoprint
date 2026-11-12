import { type RouteConfig, index, layout, prefix, route } from '@react-router/dev/routes';

export default [
    index('routes/home.tsx'),
    route('models', 'routes/models.tsx'),
    route('models/:slug', 'routes/product.tsx'),
    route('categories/:slug', 'routes/category.tsx'),
    ...prefix('admin', [
        layout('routes/admin/layout.tsx', [
            index('routes/admin/overview.tsx'),
            route('categories', 'routes/admin/categories.tsx'),
            route('products', 'routes/admin/products.tsx'),
            route('products/new', 'routes/admin/product-new.tsx'),
            route('products/:id', 'routes/admin/product-edit.tsx'),
        ]),
        // Resource route for the browser's upload steps; it answers with JSON.
        route('products/:id/media', 'routes/admin/product-media.ts'),
    ]),
    // Resource routes: no UI, they return files.
    route('sitemap.xml', 'routes/sitemap.ts'),
    route('robots.txt', 'routes/robots.ts'),
    route('*', 'routes/not-found.tsx'),
] satisfies RouteConfig;
