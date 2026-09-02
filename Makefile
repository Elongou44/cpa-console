.PHONY: build build-frontend run dev-frontend clean

build-frontend:
	cd frontend && npm install && npm run build

build: build-frontend
	go build -o cpa-console.exe ./cmd/cpa-console

run:
	go run ./cmd/cpa-console

dev-frontend:
	cd frontend && npm run dev

clean:
	go clean
	-Remove-Item -Recurse -Force data, cpa-console.exe -ErrorAction SilentlyContinue
