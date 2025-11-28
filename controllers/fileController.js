import path from "path";
import Directory from "../models/directoryModel.js";
import File from "../models/fileModel.js";
import User from "../models/userModel.js";
import {
  createGetSignedUrl,
  createUploadSignedUrl,
  deleteS3File,
  getS3FileMetaData,
} from "../services/s3.js";
import { createCloudFrontGetSignedUrl } from "../services/cloudfront.js";

export async function updateDirectoriesSize(parentId, deltaSize) {
  while (parentId) {
    const dir = await Directory.findById(parentId);
    dir.size += deltaSize;
    await dir.save();
    parentId = dir.parentDirId;
  }
}

export const getFile = async (req, res) => {
  const { id } = req.params;

  try {
    const fileData = await File.findOne({
      _id: id,
      userId: req.user._id,
    }).lean();

    // Check if file exists
    if (!fileData) {
      return res.status(404).json({ error: "File not found!" });
    }

    const isDownload = req.query.action === "download";

    const fileUrl = createCloudFrontGetSignedUrl({
      key: `${id}${fileData.extension}`,
      download: isDownload,
      filename: `${fileData.name}${fileData.extension}`,
    });

    console.log(
      `Generated ${isDownload ? "DOWNLOAD" : "PREVIEW"} URL for: ${fileData.name}${fileData.extension}`
    );

    return res.redirect(fileUrl);
  } catch (error) {
    console.error("File access error:", error);
    return res.status(500).json({ error: "Failed to access file" });
  }
};

export const renameFile = async (req, res, next) => {
  const { id } = req.params;
  const file = await File.findOne({
    _id: id,
    userId: req.user._id,
  });

  // Check if file exists
  if (!file) {
    return res.status(404).json({ error: "File not found!" });
  }

  try {
    file.name = req.body.newFilename;
    await file.save();
    return res.status(200).json({ message: "Renamed" });
  } catch (err) {
    err.status = 500;
    next(err);
  }
};

export const deleteFile = async (req, res, next) => {
  const { id } = req.params;
  const file = await File.findOne({
    _id: id,
    userId: req.user._id,
  });

  if (!file) {
    return res.status(404).json({ error: "File not found!" });
  }

  try {
    await file.deleteOne();
    await updateDirectoriesSize(file.parentDirId, -file.size);
    await deleteS3File(`${file.id}${file.extension}`);
    return res.status(200).json({ message: "File Deleted Successfully" });
  } catch (err) {
    next(err);
  }
};

export const uploadInitiate = async (req, res, next) => {
  const parentDirId = req.body.parentDirId || req.user.rootDirId;
  try {
    const parentDirData = await Directory.findOne({
      _id: parentDirId,
      userId: req.user._id,
    });

    // Check if parent directory exists
    if (!parentDirData) {
      return res.status(404).json({ error: "Parent directory not found!" }); // ADD RETURN
    }

    const filename = req.body.name || "untitled";
    const filesize = req.body.size;

    const user = await User.findById(req.user._id);
    const rootDir = await Directory.findById(req.user.rootDirId);

    const remainingSpace = user.maxStorageInBytes - rootDir.size;

    if (filesize > remainingSpace) {
      console.log("File too large");
      return res.status(507).json({ error: "Insufficient Storage" }); // ADD RETURN
    }

    const extension = path.extname(filename);

    const insertedFile = await File.create({
      extension,
      name: filename,
      size: filesize,
      parentDirId: parentDirData._id,
      userId: req.user._id,
      isUploading: true,
    });

    const uploadSignedUrl = await createUploadSignedUrl({
      key: `${insertedFile._id}${extension}`,
      contentType: req.body.contentType,
    });

    return res.json({ uploadSignedUrl, fileId: insertedFile._id }); // ADD RETURN
  } catch (err) {
    console.log(err);
    next(err);
  }
};

export const uploadComplete = async (req, res, next) => {
  const file = await File.findById(req.body.fileId);
  if (!file) {
    return res.status(404).json({ error: "File not found in our records" }); // ADD RETURN
  }

  try {
    const fileData = await getS3FileMetaData(`${file.id}${file.extension}`);
    if (fileData.ContentLength !== file.size) {
      await file.deleteOne();
      return res.status(400).json({ error: "File size does not match!" }); // ADD RETURN
    }
    file.isUploading = false;
    await file.save();
    await updateDirectoriesSize(file.parentDirId, file.size);
    return res.json({ message: "Upload completed!" }); // ADD RETURN
  } catch (err) {
    await file.deleteOne();
    return res
      .status(404)
      .json({ error: "File could not be uploaded properly!" }); // ADD RETURN
  }
};
