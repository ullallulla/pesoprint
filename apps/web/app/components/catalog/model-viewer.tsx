import { Bounds, Center, Html, OrbitControls, useBounds, useGLTF } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { RotateCcw } from 'lucide-react';
import { Component, Suspense, useEffect, useMemo, useState } from 'react';
import { Mesh, MeshStandardMaterial, Vector3 } from 'three';

/**
 * The interactive 3D preview. Loaded on demand (see `ProductGallery`), so three.js is only
 * downloaded by visitors who open the 3D view, and it never runs on the server.
 *
 * Previews are reduced GLBs without normals or materials (see the API's `model-preview.ts`):
 * every model gets the same flat-shaded, filament-like material.
 */
/** Where the camera starts, as a direction from the model (it's moved back until the model fits). */
const START_DIRECTION = [1, 0.8, 1.4] as const;

export default function ModelViewer({ url, title }: { url: string; title: string }) {
    const [webgl] = useState(supportsWebGl);
    const [resets, setResets] = useState(0);

    if (!webgl) {
        return <Message>Your browser can't show 3D models (WebGL is turned off or not supported).</Message>;
    }

    return (
        <ViewerErrorBoundary fallback={<Message>The 3D preview couldn't load. Try again later.</Message>}>
            <figure className='relative size-full'>
                <figcaption className='sr-only'>
                    3D view of {title}. Drag to rotate, right-drag or two-finger drag to move, scroll or pinch to zoom.
                </figcaption>
                <Canvas
                    camera={{ position: [...START_DIRECTION], fov: 40, near: 0.1, far: 10_000 }}
                    dpr={[1, 2]}
                    className='touch-none'
                >
                    <hemisphereLight args={['#ffffff', '#8a8a8a', 1.6]} />
                    <directionalLight position={[5, 8, 6]} intensity={1.8} />
                    <directionalLight position={[-6, 3, -4]} intensity={0.6} />
                    <Suspense fallback={<Loading />}>
                        {/* Fits the camera to the model, whatever its size. */}
                        <Bounds fit clip observe margin={1.3}>
                            <Center>
                                <Model url={url} />
                            </Center>
                            <ResetView resets={resets} />
                        </Bounds>
                    </Suspense>
                    {/* Left: rotate. Right (or two fingers): move. Wheel or pinch: zoom. */}
                    <OrbitControls makeDefault />
                </Canvas>
                <p
                    className='pointer-events-none absolute bottom-2 left-3 hidden text-xs text-muted-foreground sm:block'
                    aria-hidden
                >
                    Drag to rotate · Right-drag to move · Scroll to zoom
                </p>
                <button
                    type='button'
                    onClick={() => setResets((count) => count + 1)}
                    className='absolute top-2 right-2 inline-flex items-center gap-1.5 rounded-md border bg-background/80 px-2 py-1 text-xs font-medium backdrop-blur transition-colors hover:bg-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
                >
                    <RotateCcw className='size-3.5' aria-hidden />
                    Reset view
                </button>
            </figure>
        </ViewerErrorBoundary>
    );
}

/** Moves the camera back to where it started, framing the whole model again (animated). */
function ResetView({ resets }: { resets: number }) {
    const bounds = useBounds();
    useEffect(() => {
        if (resets === 0) return;
        const { center, distance } = bounds.refresh().clip().getSize();
        const position = new Vector3(...START_DIRECTION).normalize().multiplyScalar(distance).add(center);
        bounds.moveTo(position).lookAt({ target: center });
    }, [resets, bounds]);
    return null;
}

function Model({ url }: { url: string }) {
    const { scene } = useGLTF(url);
    const model = useMemo(() => {
        const copy = scene.clone();
        const material = new MeshStandardMaterial({
            color: '#b9bcc2',
            roughness: 0.55,
            metalness: 0.05,
            flatShading: true,
        });
        copy.traverse((object) => {
            if (object instanceof Mesh) object.material = material;
        });
        return copy;
    }, [scene]);
    return <primitive object={model} />;
}

function Loading() {
    return (
        <Html center className='text-sm whitespace-nowrap text-muted-foreground'>
            Loading 3D model…
        </Html>
    );
}

function Message({ children }: { children: React.ReactNode }) {
    return (
        <div className='flex size-full items-center justify-center p-6 text-center text-sm text-muted-foreground'>
            {children}
        </div>
    );
}

function supportsWebGl(): boolean {
    try {
        const canvas = document.createElement('canvas');
        return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
    } catch {
        return false;
    }
}

/** A failed download or a broken file shows a message instead of breaking the product page. */
class ViewerErrorBoundary extends Component<
    { fallback: React.ReactNode; children: React.ReactNode },
    { failed: boolean }
> {
    override state = { failed: false };

    static getDerivedStateFromError() {
        return { failed: true };
    }

    override render() {
        return this.state.failed ? this.props.fallback : this.props.children;
    }
}
