import { depth, TabletBottomFace, TabletTopFace } from '@/components/Tablet';
import { palette, type Product } from '@/lib/products';
import { buildTablet, SEAMS, type TabletLayer } from '@/lib/tablet';

function Discs({ layers }: { layers: TabletLayer[] }) {
  return layers.map((layer) => (
    <div
      key={layer.t}
      className="layer"
      style={{
        transform: `${depth(layer.z)} scale(${layer.scale.toFixed(3)})`,
        background: layer.background,
      }}
    />
  ));
}

/**
 * A tablet whose three pressed layers drift apart and back together. Positioned by the
 * `.ex-*` styles, sized by `--tab-s` on a parent.
 */
export function ExplodedTablet({ product }: { product: Product }) {
  const geometry = buildTablet(palette(product), 40);
  const [low, high] = SEAMS;
  return (
    <div className="tablet ex-stage">
      <div className="ex-pill">
        <div className="slab slab-bot">
          <TabletBottomFace geometry={geometry} />
          <Discs layers={geometry.layers.filter((l) => l.t < low)} />
        </div>
        <div className="slab">
          <Discs layers={geometry.layers.filter((l) => l.t >= low && l.t < high)} />
        </div>
        <div className="slab slab-top">
          <Discs layers={geometry.layers.filter((l) => l.t >= high)} />
          <TabletTopFace geometry={geometry} code={product.name.toUpperCase()} shine={false} />
        </div>
      </div>
    </div>
  );
}
