#!/bin/bash
set -e

# --- Configuration ---
P2P_REPO_PATH="~/NodeProjects/animochat-p2p"
TURN_SERVER_REPO_PATH="~/NodeProjects/animochat-turn-server"


FILES_TO_KEEP=(".gitignore" "README.md" "CNAME" "node_modules" ".elasticbeanstalk" ".nojekyll")

# --- 1. Clean the TURN server repository ---
echo "Cleaning the TURN server repository..."
cd $TURN_SERVER_REPO_PATH

# Create a string of '-not -name "file"' arguments for the find command
exclude_args=""
for file in "${FILES_TO_KEEP[@]}"; do
  exclude_args+=" -not -name \"$file\""
done

# Delete all files and directories except the ones in FILES_TO_KEEP
# The initial 'find . -mindepth 1' is to avoid deleting the root directory itself.
# The final command is constructed and executed.
eval "find . -mindepth 1 $exclude_args -delete"

echo "TURN server repository cleaned."

echo "Building the p2p project..."
cd $P2P_REPO_PATH
bun run build
echo "p2p project built successfully."


echo "Moving build files to the TURN server repository..."
mv $P2P_REPO_PATH/dist/* $TURN_SERVER_REPO_PATH/
echo "Build files moved."


echo "Fetching the latest commit message from the p2p repository..."
cd $P2P_REPO_PATH
COMMIT_MESSAGE=$(git log -1 --pretty=%B)
echo "Latest commit message: $COMMIT_MESSAGE"

# --- 5. Commit and push to the TURN server repo ---
echo "Committing and pushing changes to the TURN server repository..."
cd $TURN_SERVER_REPO_PATH
git add .
git commit -m "$COMMIT_MESSAGE"
git push
echo "Deployment complete! 🎉"