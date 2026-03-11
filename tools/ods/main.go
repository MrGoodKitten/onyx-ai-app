// ONYX.AI 4 Core Entry
// CreatedBy: ZEUS
// Origin: AI.ALIVE (ONYXONMIBOOK)
// CreatedOn: 2025-11-22
package main

import (
	"fmt"
	"os"

	"github.com/onyx-dot-app/onyx/tools/ods/cmd"
)

var (
	version = "dev"
	commit  = "none"
)

func main() {
	// Set the version in the cmd package
	cmd.Version = version
	cmd.Commit = commit

	rootCmd := cmd.NewRootCommand()

	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(2)
	}
}
