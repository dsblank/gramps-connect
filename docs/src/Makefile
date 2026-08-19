# Regenerate docs/images/*.{svg,png} from every .dot file in this directory.
#
#   make          # rebuild anything out of date
#   make clean    # remove generated images

DOT_SRCS := $(wildcard *.dot)
SVGS     := $(patsubst %.dot,../images/%.svg,$(DOT_SRCS))
PNGS     := $(patsubst %.dot,../images/%.png,$(DOT_SRCS))

.PHONY: all clean

all: $(SVGS) $(PNGS)

../images/%.svg: %.dot
	dot -Tsvg $< -o $@

../images/%.png: %.dot
	dot -Tpng -Gdpi=200 $< -o $@

clean:
	rm -f $(SVGS) $(PNGS)
