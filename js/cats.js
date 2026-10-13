(() => {
  const storageKey = "bunker-cats-enabled";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const overlay = document.createElement("div");
  overlay.id = "bunker-cats";
  overlay.setAttribute("aria-hidden", "true");
  const layer = document.createElement("div");
  layer.className = "bunker-cat-layer";
  overlay.append(layer);
  for (const eventName of ["pointerdown", "pointerup", "pointermove", "click", "dblclick"]) {
    overlay.addEventListener(eventName, (event) => event.stopPropagation());
  }

  const toggle = document.createElement("button");
  toggle.id = "bunker-cats-toggle";
  toggle.className = "bunker-cats-toggle";
  toggle.type = "button";
  toggle.setAttribute("aria-pressed", "true");
  toggle.setAttribute("aria-label", "Turn roaming cats off");
  toggle.title = "Turn roaming cats off";
  toggle.textContent = "\u{1F43E}";
  document.body.append(overlay, toggle);

  const stateWeights = [
    ["walk", 35],
    ["sit", 25],
    ["groom", 15],
    ["run", 10],
    ["roll", 8],
    ["sleep", 7],
  ];
  const colors = ["cream", "ginger", "silver", "tuxedo"];
  const cats = [];
  let enabled = true;
  let animationFrame = 0;
  let previousTime = 0;
  let previousPointer = null;

  try {
    enabled = localStorage.getItem(storageKey) !== "false";
  } catch {
    enabled = true;
  }

  function randomBetween(minimum, maximum) {
    return minimum + Math.random() * (maximum - minimum);
  }

  function nextState() {
    let pick = Math.random() * 100;
    for (const [state, weight] of stateWeights) {
      pick -= weight;
      if (pick < 0) return state;
    }
    return "walk";
  }

  function catMarkup(color) {
    return `<span class="cat-figure"><svg class="cat-art" viewBox="0 0 96 80" aria-hidden="true">
      <path class="cat-tail" d="M69 55c15-1 19-15 12-23-5-6-13-2-9 2 4 4 3 11-5 12" />
      <ellipse class="cat-body" cx="48" cy="53" rx="25" ry="18" />
      <path class="cat-leg cat-leg-back" d="M33 62v10m14-8v9m15-11v10" />
      <path class="cat-head" d="M29 40 27 19l15 9c5-2 11-2 16 0l14-9-1 22c-1 13-10 20-21 20S30 53 29 40Z" />
      <path class="cat-ear-inner" d="m32 25 8 5-7 5Zm32 0-8 5 7 5Z" />
      <ellipse class="cat-muzzle" cx="48" cy="43" rx="10" ry="7" />
      <path class="cat-face" d="M40 39h1m14 0h1m-9 7 2 2 2-2m-4 3c1 2 3 2 4 0" />
      <path class="cat-leg cat-leg-front" d="M40 65v8m16-8v8" />
      <path class="cat-whiskers" d="m37 44-10-2m10 5-9 2m31-5 10-2m-10 5 9 2" />
      <path class="cat-blush" d="M33 44h3m24 0h3" />
      <path class="cat-stripe" d="M44 28 42 33m10-6v6m7-4 1 5" />
    </svg></span><span class="cat-heart" aria-hidden="true">\u2665</span>`;
  }

  function setState(cat, state, duration = randomBetween(2, 8)) {
    cat.state = state;
    cat.stateTime = duration;
    cat.element.dataset.state = state;
  }

  function floorY(cat) {
    return Math.max(0, window.innerHeight - cat.height - 5);
  }

  function positionCat(cat) {
    const maximumX = Math.max(0, window.innerWidth - cat.width);
    cat.x = Math.max(0, Math.min(maximumX, cat.x));
    cat.y = Math.max(0, Math.min(window.innerHeight - cat.height, cat.y));
    cat.element.style.transform = `translate3d(${cat.x}px, ${cat.y}px, 0) scaleX(${cat.direction})`;
  }

  function addHeart(cat) {
    const heart = cat.element.querySelector(".cat-heart");
    heart.classList.remove("is-visible");
    void heart.offsetWidth;
    heart.classList.add("is-visible");
  }

  function createCat(index) {
    const element = document.createElement("div");
    element.className = `bunker-cat bunker-cat-${colors[index % colors.length]}`;
    element.dataset.state = reducedMotion.matches ? "sit" : "walk";
    element.innerHTML = catMarkup(colors[index % colors.length]);
    layer.append(element);

    const cat = {
      element,
      width: window.innerWidth < 480 ? 72 : 80,
      height: window.innerWidth < 480 ? 68 : 76,
      x: randomBetween(24, Math.max(25, window.innerWidth - 110)),
      y: 0,
      direction: Math.random() < 0.5 ? -1 : 1,
      state: reducedMotion.matches ? "sit" : "walk",
      stateTime: randomBetween(2, 8),
      velocityY: 0,
      dragging: false,
      dropping: false,
      movedWhileHeld: false,
      pointerOffsetX: 0,
      pointerOffsetY: 0,
    };
    cat.y = floorY(cat);
    positionCat(cat);

    element.addEventListener("pointerenter", () => element.classList.add("is-curious"));
    element.addEventListener("pointerleave", () => element.classList.remove("is-curious"));
    element.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 && event.pointerType === "mouse") return;
      cat.dragging = true;
      cat.dropping = false;
      cat.movedWhileHeld = false;
      cat.pointerOffsetX = event.clientX - cat.x;
      cat.pointerOffsetY = event.clientY - cat.y;
      element.setPointerCapture(event.pointerId);
    });
    element.addEventListener("pointermove", (event) => {
      if (!cat.dragging) return;
      if (Math.abs(event.clientX - cat.pointerOffsetX - cat.x) > 4 || Math.abs(event.clientY - cat.pointerOffsetY - cat.y) > 4) {
        cat.movedWhileHeld = true;
        setState(cat, "held", 100);
      }
      if (!cat.movedWhileHeld) return;
      cat.x = event.clientX - cat.pointerOffsetX;
      cat.y = event.clientY - cat.pointerOffsetY;
      cat.velocityY = 0;
      positionCat(cat);
    });
    element.addEventListener("pointerup", (event) => {
      if (!cat.dragging) return;
      cat.dragging = false;
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
      if (cat.movedWhileHeld) {
        cat.dropping = true;
        cat.velocityY = 0;
        setState(cat, "held", 100);
      }
    });
    element.addEventListener("pointercancel", () => {
      cat.dragging = false;
      cat.dropping = false;
      cat.y = floorY(cat);
      setState(cat, "sit", 1.5);
    });
    element.addEventListener("click", (event) => {
      if (cat.movedWhileHeld) {
        cat.movedWhileHeld = false;
        event.preventDefault();
        return;
      }
      addHeart(cat);
      if (!reducedMotion.matches) element.classList.add("is-jumping");
      setState(cat, "sit", 2.5);
      window.setTimeout(() => element.classList.remove("is-jumping"), 650);
    });
    element.addEventListener("dblclick", (event) => {
      event.preventDefault();
      setState(cat, "roll", 1.6);
    });
    return cat;
  }

  function startAnimation() {
    if (animationFrame || !enabled || document.hidden || reducedMotion.matches) return;
    previousTime = performance.now();
    animationFrame = requestAnimationFrame(tick);
  }

  function stopAnimation() {
    if (!animationFrame) return;
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
  }

  function tick(now) {
    animationFrame = 0;
    if (!enabled || document.hidden) return;
    const delta = Math.min((now - previousTime) / 1000, 0.05);
    previousTime = now;

    for (const cat of cats) {
      if (reducedMotion.matches) {
        cat.y = floorY(cat);
        setState(cat, "sit", 100);
        positionCat(cat);
        continue;
      }
      if (cat.dragging) continue;
      if (cat.dropping) {
        cat.velocityY += 1500 * delta;
        cat.y += cat.velocityY * delta;
        const floor = floorY(cat);
        if (cat.y >= floor) {
          cat.y = floor;
          cat.dropping = false;
          cat.velocityY = 0;
          setState(cat, "sit", 1.8);
        }
        positionCat(cat);
        continue;
      }

      cat.stateTime -= delta;
      if (cat.stateTime <= 0) setState(cat, nextState());
      if (cat.state === "walk" || cat.state === "run") {
        const speed = cat.state === "run" ? 190 : 64;
        cat.x += cat.direction * speed * delta;
      }
      const maximumX = Math.max(0, window.innerWidth - cat.width);
      if (cat.x <= 0 || cat.x >= maximumX) {
        cat.x = Math.max(0, Math.min(maximumX, cat.x));
        cat.direction *= -1;
      }
      cat.y = floorY(cat);
      positionCat(cat);
    }
    animationFrame = requestAnimationFrame(tick);
  }

  function updateToggle() {
    overlay.hidden = !enabled;
    toggle.setAttribute("aria-pressed", String(enabled));
    toggle.setAttribute("aria-label", `Turn roaming cats ${enabled ? "off" : "on"}`);
    toggle.title = `Turn roaming cats ${enabled ? "off" : "on"}`;
    if (enabled) startAnimation();
    else stopAnimation();
  }

  function syncCatCount() {
    const desiredCount = Math.min(4, window.innerWidth < 480 ? 1 : 2);
    while (cats.length > desiredCount) cats.pop().element.remove();
    while (cats.length < desiredCount) cats.push(createCat(cats.length));
  }

  syncCatCount();

  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    enabled = !enabled;
    try {
      localStorage.setItem(storageKey, String(enabled));
    } catch {
      // The toggle still works for the current page when storage is unavailable.
    }
    updateToggle();
  });

  window.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse") return;
    const now = performance.now();
    const speed = previousPointer ? Math.hypot(event.clientX - previousPointer.x, event.clientY - previousPointer.y) / Math.max((now - previousPointer.time) / 1000, 0.01) : 0;
    previousPointer = { x: event.clientX, y: event.clientY, time: now };
    if (speed < 650 || !enabled || reducedMotion.matches) return;
    for (const cat of cats) {
      const centerX = cat.x + cat.width / 2;
      const centerY = cat.y + cat.height / 2;
      if (Math.hypot(event.clientX - centerX, event.clientY - centerY) < 130) {
        cat.direction = centerX < event.clientX ? -1 : 1;
        setState(cat, "run", 1.8);
      }
    }
  });

  window.addEventListener("resize", () => {
    syncCatCount();
    for (const cat of cats) {
      cat.width = window.innerWidth < 480 ? 72 : 80;
      cat.height = window.innerWidth < 480 ? 68 : 76;
      cat.x = Math.min(cat.x, Math.max(0, window.innerWidth - cat.width));
      cat.y = floorY(cat);
      positionCat(cat);
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopAnimation();
    else startAnimation();
  });
  reducedMotion.addEventListener?.("change", () => {
    for (const cat of cats) setState(cat, reducedMotion.matches ? "sit" : "walk");
    if (reducedMotion.matches) stopAnimation();
    else startAnimation();
  });

  updateToggle();
})();