import { VirtuosoGrid } from 'react-virtuoso'

export default function VirtualMediaGrid({
  items,
  itemContent,
  listClassName = 'virtuoso-media-grid',
  itemClassName = 'virtuoso-media-grid-item',
  overscan = 600,
  virtualize = false,
}) {
  if (!virtualize) {
    return (
      <div className={listClassName}>
        {items.map((item, index) => (
          <div
            key={[
              item?.source_id ?? item?.direct_source_id ?? 'grid',
              item?.id ?? item?.anilist_id ?? item?.direct_manga_id ?? index,
              index,
            ].join(':')}
            className={itemClassName}
          >
            {itemContent(item, index)}
          </div>
        ))}
      </div>
    )
  }

  return (
    <VirtuosoGrid
      useWindowScroll
      overscan={overscan}
      totalCount={items.length}
      listClassName={listClassName}
      itemClassName={itemClassName}
      itemContent={(index) => itemContent(items[index], index)}
    />
  )
}
