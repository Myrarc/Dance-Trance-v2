/** A short, capped burst that travels inward from every side of the viewport. */
export function spawnEdgeStars(container: HTMLElement): void {
  const width = window.innerWidth
  const height = window.innerHeight
  const stars = document.createDocumentFragment()
  for (let index = 0; index < 56; index++) {
    const side = index % 4
    const spread = Math.random()
    const x = side === 0 ? 0 : side === 1 ? width : spread * width
    const y = side === 2 ? 0 : side === 3 ? height : spread * height
    const endX = width * (.43 + Math.random() * .14)
    const endY = height * (.41 + Math.random() * .18)
    const star = document.createElement('span')
    star.className = 'edge-star'
    star.style.left = `${x}px`
    star.style.top = `${y}px`
    star.style.setProperty('--star-dx', `${endX - x}px`)
    star.style.setProperty('--star-dy', `${endY - y}px`)
    star.style.setProperty('--star-delay', `${Math.random() * 110}ms`)
    star.addEventListener('animationend', () => star.remove(), { once: true })
    stars.appendChild(star)
  }
  container.replaceChildren(stars)
}
