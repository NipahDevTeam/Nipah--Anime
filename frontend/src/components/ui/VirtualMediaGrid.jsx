import { VirtuosoGrid } from 'react-virtuoso'

export default function VirtualMediaGrid({
  items,
  itemContent,
  listClassName = 'virtuoso-media-grid',
  itemClassName = 'virtuoso-media-grid-item',
  overscan = 600,
}) {
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
