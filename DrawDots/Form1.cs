using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Data;
using System.Drawing;
using System.Linq;
using System.Text;
using System.Windows.Forms;
using DotsUtil;

namespace DrawDots
{
    public partial class Form1 : Form
    {
        public Form1()
        {
            InitializeComponent();
        }

        private void Form1_Load(object sender, EventArgs e)
        {
        }

        public int NumToDraw { get; set; }
        public int TotalDrawn { get; set; }


        void DR_LetterUpddate(int NumberDrawn, int NumberToDraw, Bitmap arg2)
        {
            int Division = NumberToDraw / 100;
            if (Division < 10)
            {
                Division = 1;
            }

            if (NumberDrawn % Division != 0)
                return;
            try
            {
                pbLetter.Maximum = NumberToDraw;
                pbLetter.Value = NumberDrawn;
                pbTotal.Value = TotalDrawn + NumberDrawn;
                lblElapsed.Text = (DateTime.Now - Start).ToString();
            }
            catch { }
            this.Text = NumberDrawn.ToString();
            try
            {
                //if (NumberDrawn % 100 == 0)
                //arg2.Save("C:\\Users\\Adam\\out.bmp");
            }
            catch
            { }
            Application.DoEvents();
            pictureBox1.Image = arg2;

            Invalidate();
            Refresh();
        }
        DateTime Start { get; set; }
        private void button1_Click(object sender, EventArgs e)
        {
            TotalDrawn = 0;
            int x = int.Parse(textBox1.Text);
            pbTotal.Maximum = x;
            NumToDraw = x;
            DotRenderer DR = new DotRenderer(x);
            DR.LetterUpddate += new Action<int, int, Bitmap>(DR_LetterUpddate);
            DR.ImageUpdated += new Action<int, Bitmap>(DR_ImageUpdated);
            Start = DateTime.Now;
            DR.DrawIt();
            /*try
            {
                SaveFileDialog SFD = new SaveFileDialog();
                SFD.Filter = "PNG Files (*.png)|";
                SFD.FilterIndex = 0;
                SFD.InitialDirectory = System.Environment.GetFolderPath(System.Environment.SpecialFolder.UserProfile);
                if (SFD.ShowDialog() == System.Windows.Forms.DialogResult.OK)
                {



                    string FileName = SFD.FileName;
                    FileName = System.IO.Path.ChangeExtension(FileName, "png");
                    //DR.Image.Save(@"C:\users\adam\out.bmp");
                    pictureBox2.Image.Save(FileName, System.Drawing.Imaging.ImageFormat.Png);
                }
            }
            catch (Exception exp)
            {
                MessageBox.Show(exp.Message);
            }
            */
        }

        void DR_ImageUpdated(int NumDrawn, Bitmap arg2)
        {
            TotalDrawn = NumDrawn;
            pictureBox2.Image = arg2;
            Application.DoEvents();
        }

        private void button2_Click(object sender, EventArgs e)
        {
            pictureBox1.Image = null;
            pictureBox2.Image = null;
        }

        private void btnSave_Click(object sender, EventArgs e)
        {
            try
            {
                SaveFileDialog SFD = new SaveFileDialog();
                SFD.Filter = "PNG Files (*.png)|";
                SFD.FilterIndex = 0;
                SFD.InitialDirectory = System.Environment.GetFolderPath(System.Environment.SpecialFolder.UserProfile);
                if (SFD.ShowDialog() == System.Windows.Forms.DialogResult.OK)
                {
                    string FileName = SFD.FileName;
                    FileName = System.IO.Path.ChangeExtension(FileName, "png");
                    //DR.Image.Save(@"C:\users\adam\out.bmp");
                    pictureBox2.Image.Save(FileName, System.Drawing.Imaging.ImageFormat.Png);
                }
            }
            catch (Exception exp)
            {
                MessageBox.Show(exp.Message);

            }
        }
    }
}
