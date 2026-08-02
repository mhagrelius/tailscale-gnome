UUID = tailscale@hagreli.us
SRC = src/$(UUID)
INSTALL_DIR = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
BUILD_DIR = build

.PHONY: all schemas install uninstall enable disable pack lint logs clean

all: schemas

schemas: $(SRC)/schemas/gschemas.compiled

$(SRC)/schemas/gschemas.compiled: $(SRC)/schemas/*.gschema.xml
	glib-compile-schemas $(SRC)/schemas

install: schemas
	rm -rf $(INSTALL_DIR)
	mkdir -p $(INSTALL_DIR)
	cp -r $(SRC)/. $(INSTALL_DIR)

uninstall:
	rm -rf $(INSTALL_DIR)

enable:
	gnome-extensions enable $(UUID)

disable:
	gnome-extensions disable $(UUID)

# A shareable zip, in the layout extensions.gnome.org expects.
pack: schemas
	mkdir -p $(BUILD_DIR)
	gnome-extensions pack $(SRC) \
		--force \
		--out-dir=$(BUILD_DIR) \
		--extra-source=daemon \
		--extra-source=features \
		--extra-source=ui \
		--extra-source=icons

lint:
	@command -v eslint >/dev/null || { echo "eslint not installed; skipping"; exit 0; }
	eslint $(SRC)

# Extension output only, since the shell's journal is noisy.
logs:
	journalctl -f -o cat /usr/bin/gnome-shell | grep -i --line-buffered tailscale

clean:
	rm -rf $(BUILD_DIR) $(SRC)/schemas/gschemas.compiled
