import Directory from "../models/directoryModel.js";
import File from "../models/fileModel.js";
import { updateDirectoriesSize } from "./fileController.js";
import { deleteS3Files } from "../services/s3.js";

export const getDirectory = async (req, res) => {
  const user = req.user;
  const _id = req.params.id || user.rootDirId.toString();
  const directoryData = await Directory.findOne({
    _id,
    userId: req.user._id,
  }).lean();
  if (!directoryData) {
    return res
      .status(404)
      .json({ error: "Directory not found or you do not have access to it!" });
  }

  const files = await File.find({ parentDirId: directoryData._id }).lean();
  const directories = await Directory.find({ parentDirId: _id }).lean();
  return res.status(200).json({
    ...directoryData,
    files: files.map((dir) => ({ ...dir, id: dir._id })),
    directories: directories.map((dir) => ({ ...dir, id: dir._id })),
  });
};

export const createDirectory = async (req, res, next) => {
  const user = req.user;

  const parentDirId = req.params.parentDirId || user.rootDirId.toString();
  const dirname = req.headers.dirname || "New Folder";
  try {
    const parentDir = await Directory.findOne({
      _id: parentDirId,
    }).lean();

    if (!parentDir)
      return res
        .status(404)
        .json({ message: "Parent Directory Does not exist!" });

    await Directory.insertOne({
      name: dirname,
      parentDirId,
      userId: user._id,
    });

    return res.status(201).json({ message: "Directory Created!" });
  } catch (err) {
    if (err.code === 121) {
      res
        .status(400)
        .json({ error: "Invalid input, please enter valid details" });
    } else {
      next(err);
    }
  }
};

export const renameDirectory = async (req, res, next) => {
  const user = req.user;
  const { id } = req.params;
  const { newDirName } = req.body;
  try {
    await Directory.findOneAndUpdate(
      {
        _id: id,
        userId: user._id,
      },
      { name: newDirName }
    );
    res.status(200).json({ message: "Directory Renamed!" });
  } catch (err) {
    next(err);
  }
};

export const deleteDirectory = async (req, res, next) => {
  const { id } = req.params;

  try {
    const directoryData = await Directory.findOne({
      _id: id,
      userId: req.user._id,
    }).lean();

    if (!directoryData) {
      return res.status(404).json({ error: "Directory not found!" });
    }

    async function getDirectoryContents(dirId) {
      let files = await File.find({ parentDirId: dirId })
        .select("_id extension")
        .lean();
      let directories = await Directory.find({ parentDirId: dirId })
        .select("_id")
        .lean();

      // Initialize with current directory
      let allDirectories = [{ _id: dirId }];

      for (const { _id } of directories) {
        const { files: childFiles, directories: childDirectories } =
          await getDirectoryContents(_id);

        files = [...files, ...childFiles];
        allDirectories = [...allDirectories, ...childDirectories];
      }

      return { files, directories: allDirectories };
    }

    const { files, directories } = await getDirectoryContents(id);

    // Delete files from S3 if there are any
    if (files.length > 0) {
      const keys = files.map(({ _id, extension }) => ({
        Key: `${_id}${extension}`,
      }));
      await deleteS3Files(keys);
    }

    // Delete all files
    if (files.length > 0) {
      await File.deleteMany({
        _id: { $in: files.map(({ _id }) => _id) },
      });
    }

    // Delete all directories (including empty ones)
    await Directory.deleteMany({
      _id: { $in: directories.map(({ _id }) => _id) },
    });

    // Update parent directory size
    await updateDirectoriesSize(directoryData.parentDirId, -directoryData.size);

    return res.json({ message: "Directory deleted successfully" });
  } catch (err) {
    next(err);
  }
};
