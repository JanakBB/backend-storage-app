import path from "path";
import Directory from "../models/directoryModel.js";
import File from "../models/fileModel.js";
import User from "../models/userModel.js";
import { createCloudFrontGetSignedUrl } from "../services/cloudfront.js";
import {
  createUploadSignedUrl,
  deleteS3File,
  getS3FileMetaData,
} from "../services/s3.js";

/**
 * Updates directory size recursively
 */
export async function updateDirectoriesSize(parentId, deltaSize) {
  while (parentId) {
    const dir = await Directory.findById(parentId);
    if (!dir) break;

    dir.size += deltaSize;
    await dir.save();
    parentId = dir.parentDirId;
  }
}

/**
 * GET FILE
 * Handles preview vs download
 */
export const getFile = async (req, res) => {
  try {
    const { id } = req.params;

    const fileData = await File.findOne({
      _id: id,
      userId: req.user._id,
    }).lean();

    if (!fileData) {
      return res.status(404).json({ error: "File not found!" });
    }

    const isDownload = req.query.action === "download";

    const fileUrl = createCloudFrontGetSignedUrl({
      key: `${id}${fileData.extension}`,
      download: isDownload,
      filename: fileData.name,
    });

    return res.redirect(fileUrl);
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * RENAME FILE
 */
export const renameFile = async (req, res, next) => {
  try {
    const { id } = req.params;

    const file = await File.findOne({
      _id: id,
      userId: req.user._id,
    });

    if (!file) {
      return res.status(404).json({ error: "File not found!" });
    }

    file.name = req.body.newFilename;
    await file.save();

    return res.status(200).json({ message: "Renamed" });
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE FILE
 */
export const deleteFile = async (req, res, next) => {
  try {
    const { id } = req.params;

    const file = await File.findOne({
      _id: id,
      userId: req.user._id,
    });

    if (!file) {
      return res.status(404).json({ error: "File not found!" });
    }

    await file.deleteOne();
    await updateDirectoriesSize(file.parentDirId, -file.size);

    await deleteS3File(`${file.id}${file.extension}`);

    return res.status(200).json({ message: "File Deleted Successfully" });
  } catch (err) {
    next(err);
  }
};

/**
 * UPLOAD INITIATE
 * Creates DB file record + S3 signed upload URL
 */
export const uploadInitiate = async (req, res, next) => {
  try {
    const parentDirId = req.body.parentDirId || req.user.rootDirId;

    const parentDirData = await Directory.findOne({
      _id: parentDirId,
      userId: req.user._id,
    });

    if (!parentDirData) {
      return res.status(404).json({ error: "Parent directory not found!" });
    }

    const filename = req.body.name || "untitled";
    const filesize = req.body.size;

    const user = await User.findById(req.user._id);
    const rootDir = await Directory.findById(req.user.rootDirId);

    const remainingSpace = user.maxStorageInBytes - rootDir.size;

    if (filesize > remainingSpace) {
      return res.status(507).json({ error: "Insufficient Storage" });
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

    return res.json({ uploadSignedUrl, fileId: insertedFile._id });
  } catch (err) {
    next(err);
  }
};

/**
 * UPLOAD COMPLETE
 * Confirms file exists in S3, verifies size, and finalizes upload
 */
export const uploadComplete = async (req, res, next) => {
  try {
    const file = await File.findById(req.body.fileId);

    if (!file) {
      return res.status(404).json({ error: "File not found in our records" });
    }

    const fileData = await getS3FileMetaData(`${file.id}${file.extension}`);

    if (fileData.ContentLength !== file.size) {
      await file.deleteOne();
      return res.status(400).json({ error: "File size does not match!" });
    }

    file.isUploading = false;
    await file.save();

    await updateDirectoriesSize(file.parentDirId, file.size);

    return res.json({ message: "Upload completed!" });
  } catch (err) {
    return res
      .status(404)
      .json({ error: "File could not be uploaded properly!" });
  }
};
