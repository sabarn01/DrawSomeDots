using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Data;
using System.Drawing;
using System.Linq;
using System.Text;
using System.Windows.Forms;

namespace FontTest
{
    public partial class Form1 : Form
    {
        public Form1()
        {
            InitializeComponent();
        }

        private void button1_Click(object sender, EventArgs e)
        {
            Bitmap B = new Bitmap(pictureBox1.Width, pictureBox1.Height);
            Graphics G = Graphics.FromImage(B);
            int StartSize = 20;
            int Increment = 10;
            Point St = new Point(60,60);
            Size S = new  Size(StartSize,StartSize);
            for (int x = 0; x < 10; x++)
            {
                Rectangle r;
                if (x == 0)
                {
                    
                    r = new Rectangle(St,S );
                }
                else
                {
                    int y = x ;
                    int Offset =  ((y * Increment) /2);
                    Point pf = new Point(St.X - Offset,St.Y - Offset);
                    Size s = new Size(StartSize +  (x *Increment), StartSize + (x * Increment) );
                    r = new Rectangle(pf, s);

                }

                G.DrawEllipse(new Pen(Color.Black),r);
               
            }
            pictureBox1.Image = B;
        }
    }
}
