# The Gramps Connect tour

A narrated, self-playing walkthrough of Gramps Connect, published with the
rest of the repo on GitHub Pages at
<https://dsblank.github.io/gramps-connect/tour/>. Any push to `main`
republishes it.

| File | What it is |
| --- | --- |
| `scenes.js` | The content: scenes, steps and narration. This is the file to edit. |
| `img/*.jpg` | One screenshot per frame, every one exactly 1519 × 784. |
| `index.html` | The player (camera, pointer, highlighter, read-aloud). Normally untouched. |

## Changing the words

Edit the `text` of a step in `scenes.js`. The highlighter, the read-aloud
voice, the timing and the progress bar all follow the text, so nothing else
needs to change. Adding, removing or reordering steps and scenes works the
same way.

## Changing where the camera and pointer go

Positions are in screenshot pixels, which are hard to guess, so the player
has an edit mode for finding them:

1. Serve the repo locally, for example `python3 -m http.server` from the
   repo root, and open `http://localhost:8000/tour/?edit`. (Opening the file
   directly also works, but copying to the clipboard may not.)
2. Go to the step you want with the arrows or by clicking its line.
3. Click on the screenshot to pick a point, then **Pointer here**,
   **Camera here** or **Typing here**. **Zoom −/+** and **Click** adjust the
   rest. Each change plays straight away so you can see it.
4. **Copy scenes.js** copies the whole file with your changes; paste it over
   `tour/scenes.js`. **Copy step** copies just the current step.

Edit mode never saves anything itself, so reloading the page discards
changes that weren't copied.

## Adding a screenshot

Take it from the app in a browser window whose page area is 1519 × 784, so
it lines up with the others when the frames crossfade. Move the mouse
pointer off the page first; the player draws its own. Save it as
`img/<name>.jpg` and use `<name>` as the step's `img`.

The tour uses the US Presidents example tree. Photos shown in it come from
Wikimedia Commons; keep the credits at the bottom of `index.html` in step
with any you add.
