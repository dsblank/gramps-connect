// Gramps Connect tour: the scenes and their narration.
// Edit this file to change the tour; index.html is the player and needs no changes.
// To find coordinates, open index.html?edit and click on a screenshot (see README.md).
//
// Each step:
//   img     screenshot in img/, without ".jpg"; every screenshot is 1519 x 784
//   cam     [x, y, zoom]: where the camera centres, in screenshot pixels; zoom 1 shows it all
//   cur     [x, y]: where the pointer moves to
//   click   true to show a click ripple when the pointer arrives
//   type    text typed into a box at typeAt [x, y] (default [131, 95])
//   text    the narration: shown on the right, highlighted and read aloud
window.TOUR_SCENES = [
  { title: "Home", url: "#/home", steps: [
    { img: "home", cam: [760, 392, 1], cur: [760, 420],
      text: "Signing in opens Home, a one-page summary of the tree. This is the US Presidents example: 2,266 people, 1,117 families and nearly 4,000 events." },
    { img: "home", cam: [308, 200, 2.3], cur: [212, 163],
      text: "The home person is who everything else is measured from, such as how others are related and which anniversaries come up. Here it's Abraham Lincoln." },
    { img: "home", cam: [780, 380, 2], cur: [640, 282],
      text: "The Change Log lists the latest edits to the tree. Today's entries are the map outlines added for this tour." },
    { img: "home", cam: [1253, 175, 2.3], cur: [1146, 160],
      text: "Stories, discussions and bookmarks sit alongside, each one click away." },
  ]},
  { title: "Finding someone", url: "#/person", steps: [
    { img: "home", cam: [380, 300, 1.4], cur: [27, 134], click: true,
      text: "The rail on the left has one icon per kind of record, the same categories Gramps uses. The first opens People." },
    { img: "people", cam: [420, 120, 2.3], cur: [300, 104], click: true, type: "lincoln",
      text: "To find someone, type part of their name, or a Gramps ID, into the search box." },
    { img: "lincoln", cam: [440, 230, 1.8], cur: [250, 162], click: true,
      text: "The list narrows as you type. Abraham Lincoln is at the top." },
    { img: "lincoln", cam: [1180, 330, 1.6], cur: [990, 154],
      text: "His record opens beside the list: his photo, his events, his parents and his family. Pick another row and this side follows." },
    { img: "lincoln", cam: [1180, 545, 2.2], cur: [940, 540],
      text: "This portrait was added by dragging the file onto his record. Its caption carries the photographer and the license." },
  ]},
  { title: "Family", url: "#/tree", steps: [
    { img: "lincoln", cam: [1000, 200, 2.4], cur: [1008, 206], click: true,
      text: "Graphs draws the family around whoever you're looking at." },
    { img: "tree", cam: [760, 420, 1], cur: [790, 410],
      text: "Parents and grandparents fan out to the right, children to the left. Cards show photos where the tree has them." },
    { img: "tree", cam: [1200, 400, 1.6], cur: [1267, 189], click: true,
      text: "A − folds a branch away and a + opens the next generation, so a large tree stays readable." },
    { img: "tree", cam: [220, 90, 2.6], cur: [172, 77], click: true,
      text: "The same family as a fan chart:" },
    { img: "fan", cam: [787, 413, 1.05], cur: [787, 470],
      text: "Each ring is one generation further back. You can rotate it, add generations, and shade it by lifespan." },
  ]},
  { title: "Maps", url: "#/map", steps: [
    { img: "map", cam: [787, 420, 1], cur: [700, 470],
      text: "Every place in the tree has coordinates, so every event can go on a map. This is Kentucky, where Lincoln was born." },
    { img: "map", cam: [800, 410, 2.4], cur: [793, 412],
      text: "The state and county outlines came from Wikidata. A lookup links a place in the tree to its Wikidata entry and brings the boundary along." },
    { img: "map", cam: [1390, 180, 2.6], cur: [1305, 176],
      text: "The Overlays panel lists the outlines in view. Each one can be hidden, or faded to see the map underneath." },
    { img: "map", cam: [930, 80, 2.6], cur: [966, 77], click: true,
      text: "Historical swaps today's map for one of the period." },
    { img: "map1809", cam: [1150, 80, 2.6], cur: [1158, 77], click: true,
      text: "Pick a year, here 1809, the year Lincoln was born:" },
    { img: "map1809", cam: [800, 400, 1], cur: [1370, 352],
      text: "The towns and borders are those of that year. West Virginia is still part of Virginia." },
  ]},
  { title: "Stories", url: "#/story", steps: [
    { img: "story", cam: [760, 392, 1], cur: [1047, 560],
      text: "Every person can have a story, a slideshow built from the tree. Lincoln's was generated with one click, including his family." },
    { img: "story", cam: [1300, 392, 2], cur: [1477, 392], click: true,
      text: "Use the arrows or the keyboard to move from moment to moment." },
    { img: "story-birth", cam: [760, 392, 1], cur: [1047, 560],
      text: "The map moves to where each moment happened, and a photo of the place appears when the tree has one: Sinking Spring, Kentucky, 1809." },
    { img: "story-mary", cam: [760, 392, 1], cur: [1047, 580],
      text: "Relatives' moments are woven in. His wife Mary Todd's birth, in Lexington, shows her portrait." },
    { img: "story-ford", cam: [1047, 380, 1.45], cur: [1047, 588],
      text: "Each slide starts with words drawn from the tree, and you can rewrite any of them. This one was retitled \"Shot at Ford's Theater\" and given a sentence of its own." },
    { img: "story-ford", cam: [760, 740, 2], cur: [879, 760],
      text: "The timeline along the bottom marks every moment, so you can see the shape of a whole life at a glance." },
  ]},
];
